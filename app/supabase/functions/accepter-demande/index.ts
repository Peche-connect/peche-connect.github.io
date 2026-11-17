// Un pêcheur répond « Je peux fournir » au besoin d'un pro : la commande est créée,
// le pro est prévenu et la paie depuis son bon (même empreinte qu'une réservation).
import { montantBloque, type Reglages } from '../_shared/montants.ts';
import { notifier } from '../_shared/notifier.ts';
import { admin, corps, Erreur, servir, utilisateur } from '../_shared/outils.ts';

servir(async (req) => {
  const u = await utilisateur(req);
  const { id } = await corps<{ id: string }>(req);
  const db = admin();
  const { data: etal } = await db.from('etals').select('id, prenom, statut, stripe_pret').eq('pecheur_id', u.id).single();
  if (!etal || etal.statut !== 'verifie' || !etal.stripe_pret) throw new Erreur(403, 'Compte pêcheur pas encore prêt.');
  const { data: d } = await db.from('demandes').select('*').eq('id', id).single();
  if (!d || d.statut !== 'ouverte') throw new Erreur(409, 'Ce besoin a déjà été pris par un autre pêcheur.');
  const { data: pro } = await db.from('pros').select('*').eq('profil_id', d.pro_id).single();
  const { data: prof } = await db.from('profils').select('prenom').eq('id', d.pro_id).single();
  const { data: r } = await db.from('reglages').select('*').single();

  const lignes = [{ produitId: null, espece: d.espece, kg: Number(d.kg), prixKg: Number(d.prix_max_kg), preparation: 'Entier', supplementKg: 0 }];
  const livraison = d.livraison ? { adresse: pro?.adresse || (pro?.raison + ', ' + pro?.commune), frais: Number(r!.frais_livraison) } : null;
  // réservation atomique du besoin : seul le premier pêcheur l'obtient
  const { data: pris } = await db.from('demandes').update({ statut: 'acceptee', etal_id: etal.id }).eq('id', id).eq('statut', 'ouverte').select('id');
  if (!pris?.length) throw new Erreur(409, 'Ce besoin a déjà été pris par un autre pêcheur.');

  const { data: bon, error } = await db.from('bons').insert({
    etal_id: etal.id, client_id: d.pro_id, client_prenom: d.pro_raison,
    pro: pro ? { raison: pro.raison, type: pro.type, siret: pro.siret, commune: pro.commune, adresse: pro.adresse } : null,
    livraison, lignes, creneau: d.pour === 'Demain' ? 'Demain matin' : 'Aujourd’hui',
    montant_bloque: montantBloque(r as Reglages, lignes, livraison?.frais ?? 0),
  }).select().single();
  if (error || !bon) { await db.from('demandes').update({ statut: 'ouverte', etal_id: null }).eq('id', id); throw error ?? new Erreur(500, 'Commande impossible.'); }
  await db.from('demandes').update({ bon_code: bon.code }).eq('id', id);

  const { data: conv } = await db.from('conversations').upsert(
    { etal_id: etal.id, client_id: d.pro_id, client_prenom: d.pro_raison || prof?.prenom || 'Pro', bon_code: bon.code, lu_client: false },
    { onConflict: 'etal_id,client_id' },
  ).select('id').single();
  if (conv) await db.from('messages').insert({
    conversation_id: conv.id, auteur_id: u.id, auteur: 'pecheur',
    texte: 'Bonjour, je peux vous fournir ' + d.kg + ' kg de ' + String(d.espece).toLowerCase() + ' à ' + Number(d.prix_max_kg).toFixed(2).replace('.', ',') + ' €/kg (' + String(d.pour).toLowerCase() + '). Commande ' + bon.code + ' créée : réglez-la depuis votre bon pour la confirmer.',
  });
  await notifier([d.pro_id], etal.prenom + ' peut vous fournir', d.kg + ' kg de ' + d.espece + ' · commande ' + bon.code + ' à confirmer', { lien: '/bon/' + bon.code });
  return { code: bon.code };
});
