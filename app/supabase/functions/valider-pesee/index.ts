// Pesée devant le client : encaisse le poids réel (capture partielle de l'empreinte),
// prélève la part de la plateforme et reverse le reste au pêcheur automatiquement.
// Tout à 0 kg (pêcheur en rupture) : l'empreinte est annulée, rien n'est débité.
import { montantsPesee, type Reglages } from '../_shared/montants.ts';
import { notifier } from '../_shared/notifier.ts';
import { admin, centimes, corps, Erreur, journal, servir, stripe, utilisateur } from '../_shared/outils.ts';

servir(async (req) => {
  const u = await utilisateur(req);
  const { code, poids } = await corps<{ code: string; poids: number[] }>(req);
  const db = admin();
  const { data: bon } = await db.from('bons').select('*, etals!inner(pecheur_id)').eq('code', code).single();
  if (!bon) throw new Erreur(404, 'Bon introuvable.');
  if ((bon.etals as { pecheur_id: string }).pecheur_id !== u.id) throw new Erreur(403, 'Ce bon n’est pas pour votre étal.');
  if (!['reserve', 'en_livraison'].includes(bon.statut)) throw new Erreur(409, 'Ce bon est déjà clôturé.');
  const lignes = (bon.lignes as { kg: number; prixKg: number; supplementKg: number }[]);
  if (!Array.isArray(poids) || poids.length !== lignes.length || poids.some((p) => !(p >= 0 && p < 1000))) throw new Erreur(400, 'Poids invalides.');

  const pesees = lignes.map((l, i) => ({ ...l, kg: Math.round(poids[i] * 10) / 10 }));
  const { data: r } = await db.from('reglages').select('*').single();
  const livraison = Number((bon.livraison as { frais?: number } | null)?.frais ?? 0);
  const m = montantsPesee(r as Reglages, pesees, livraison);

  if (pesees.every((l) => l.kg === 0)) {
    await stripe().paymentIntents.cancel(bon.stripe_paiement);
    await db.from('bons').update({ statut: 'annule', lignes: pesees, montant_paye: 0, retire_le: new Date().toISOString() }).eq('id', bon.id);
    if (bon.client_id) await notifier([bon.client_id], 'Réservation ' + code + ' annulée', 'Rien ne vous a été débité.');
    return { annule: true };
  }
  if (m.total > Number(bon.montant_bloque) + 0.001) throw new Erreur(409, 'Au-delà du montant bloqué : retirez un peu de poisson ou faites une nouvelle réservation pour le supplément.');

  await stripe().paymentIntents.capture(bon.stripe_paiement, {
    amount_to_capture: centimes(m.total),
    application_fee_amount: centimes(m.plateforme),
  });
  await db.from('bons').update({
    statut: 'retire', lignes: pesees, montant_paye: m.total, commission: m.plateforme, retire_le: new Date().toISOString(),
  }).eq('id', bon.id);
  await journal(u.id, 'pesée', { code, total: m.total, plateforme: m.plateforme });
  if (bon.client_id) await notifier([bon.client_id], 'Retrait ' + code + ' validé', 'Payé ' + m.total.toFixed(2).replace('.', ',') + ' €. Bon appétit !');
  return { montantPaye: m.total, pourLePecheur: m.pourLePecheur };
});
