// Page de paiement d'un bon pas encore payé (commande d'un pro acceptée par un pêcheur,
// ou paiement interrompu) : renvoie un nouveau lien Stripe, pour le client du bon uniquement.
import { admin, centimes, corps, Erreur, servir, site, stripe, utilisateur } from '../_shared/outils.ts';

servir(async (req) => {
  const u = await utilisateur(req);
  const { code } = await corps<{ code: string }>(req);
  const db = admin();
  const { data: bon } = await db.from('bons').select('*').eq('code', String(code)).single();
  if (!bon || bon.client_id !== u.id) throw new Erreur(404, 'Bon introuvable.');
  if (bon.statut !== 'en_attente_paiement') throw new Erreur(409, 'Ce bon est déjà payé ou annulé.');
  const { data: prive } = await db.from('etals_prive').select('stripe_compte').eq('etal_id', bon.etal_id).single();
  if (!prive?.stripe_compte) throw new Erreur(409, 'Ce pêcheur ne peut pas encore recevoir de paiement.');
  const s = stripe();
  if (bon.stripe_session) { try { await s.checkout.sessions.expire(bon.stripe_session); } catch { /* déjà expirée */ } }
  const session = await s.checkout.sessions.create({
    mode: 'payment', locale: 'fr', customer_email: u.email ?? undefined,
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: centimes(bon.montant_bloque), product_data: { name: 'Commande ' + bon.code + ' (montant maximum)' } } }],
    payment_intent_data: { capture_method: 'manual', transfer_data: { destination: prive.stripe_compte }, metadata: { bon_code: bon.code, bon_id: bon.id } },
    metadata: { bon_code: bon.code, bon_id: bon.id, relance: '1' }, // relance : l'expiration n'annule pas le bon
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    success_url: site() + '/bon/' + bon.code + '?paye=1',
    cancel_url: site() + '/bon/' + bon.code,
  });
  await db.from('bons').update({ stripe_session: session.id }).eq('id', bon.id);
  return { url: session.url };
});
