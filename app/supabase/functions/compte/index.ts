// « Mon compte » : export de toutes mes données (droit d'accès RGPD) et suppression du compte
// (droit à l'effacement). Les bons payés sont gardés 10 ans pour la comptabilité, mais anonymisés.
import { admin, corps, Erreur, servir, utilisateur } from '../_shared/outils.ts';

servir(async (req) => {
  const u = await utilisateur(req);
  const { action } = await corps<{ action: 'exporter' | 'supprimer' }>(req);
  const db = admin();

  if (action === 'exporter') {
    const [profil, pro, etal, bons, convs, demandes, suivis] = await Promise.all([
      db.from('profils').select('*').eq('id', u.id).maybeSingle(),
      db.from('pros').select('*').eq('profil_id', u.id).maybeSingle(),
      db.from('etals').select('*, etals_prive(lieu, precision, immatriculation), produits(*)').eq('pecheur_id', u.id).maybeSingle(),
      db.from('bons').select('code, lignes, creneau, statut, montant_bloque, montant_paye, livraison, pro, cree_le, paye_le, retire_le').eq('client_id', u.id),
      db.from('conversations').select('id, bon_code, cree_le, messages(auteur, texte, audio, cree_le)').eq('client_id', u.id),
      db.from('demandes').select('*').eq('pro_id', u.id),
      db.from('suivis').select('espece, commune').eq('profil_id', u.id),
    ]);
    return {
      exporte_le: new Date().toISOString(),
      compte: { id: u.id, email: u.email, telephone: u.phone, cree_le: u.created_at },
      profil: profil.data, professionnel: pro.data, etal: etal.data,
      bons: bons.data, conversations: convs.data, besoins: demandes.data, especes_suivies: suivis.data,
    };
  }

  if (action === 'supprimer') {
    const { data: etal } = await db.from('etals').select('id').eq('pecheur_id', u.id).maybeSingle();
    if (etal) {
      const { count } = await db.from('bons').select('id', { count: 'exact', head: true }).eq('etal_id', etal.id).in('statut', ['reserve', 'en_livraison']);
      if (count) throw new Erreur(409, 'Vous avez encore ' + count + ' réservation(s) à honorer : clôturez-les avant de supprimer votre compte.');
    }
    const { count: enCours } = await db.from('bons').select('id', { count: 'exact', head: true }).eq('client_id', u.id).in('statut', ['reserve', 'en_livraison']);
    if (enCours) throw new Erreur(409, 'Vous avez une réservation en cours : retirez-la ou attendez son annulation avant de supprimer votre compte.');
    // messages vocaux des conversations du client : fichiers effacés
    const { data: convs } = await db.from('conversations').select('id').eq('client_id', u.id);
    for (const c of convs ?? []) {
      const { data: fichiers } = await db.storage.from('messages-audio').list(c.id);
      if (fichiers?.length) await db.storage.from('messages-audio').remove(fichiers.map((f) => c.id + '/' + f.name));
    }
    await db.rpc('anonymiser_compte', { p_id: u.id });
    if (etal) { // l'étal disparaît de la vitrine ; ses ventes passées restent pour la comptabilité
      await db.from('produits').delete().eq('etal_id', etal.id);
      await db.from('etals').update({ statut: 'suspendu', prenom: 'Compte supprimé', photo_url: null }).eq('id', etal.id);
      await db.from('etals_prive').update({ lieu: null, precision: null, immatriculation: null }).eq('etal_id', etal.id);
    }
    const { error } = await db.auth.admin.deleteUser(u.id);
    if (error) throw error;
    return { supprime: true };
  }
  throw new Erreur(400, 'Action inconnue.');
});
