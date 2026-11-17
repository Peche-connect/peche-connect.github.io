// Réservation : vérifie le panier côté serveur (prix et stock de la base, jamais ceux envoyés par
// le téléphone), retire le poisson du stock, puis ouvre la page de paiement Stripe.
// Le paiement est une EMPREINTE (capture manuelle) : rien n'est débité avant la pesée.
import { admin, centimes, corps, Erreur, servir, site, stripe, utilisateur } from '../_shared/outils.ts';

type Entree = { etalId: string; lignes: { produitId: string; kg: number; preparation: string }[]; creneau: string; livraison?: boolean };

servir(async (req) => {
  const u = await utilisateur(req);
  const e = await corps<Entree>(req);
  if (!e.etalId || !Array.isArray(e.lignes) || !e.lignes.length || e.lignes.length > 20) throw new Erreur(400, 'Panier invalide.');
  const db = admin();

  const { data: prive } = await db.from('etals_prive').select('stripe_compte').eq('etal_id', e.etalId).single();
  if (!prive?.stripe_compte) throw new Erreur(409, 'Ce pêcheur ne peut pas encore recevoir de paiement.');

  // Crée le bon et retire le stock en une seule opération (fonction SQL creer_bon)
  const { data: bon, error } = await db.rpc('creer_bon', {
    p_client: u.id, p_etal: e.etalId,
    p_lignes: e.lignes.map((l) => ({ produitId: l.produitId, kg: Math.round(Number(l.kg) * 10) / 10, preparation: String(l.preparation ?? '') })),
    p_creneau: String(e.creneau ?? 'Avant 10 h').slice(0, 40), p_livraison: !!e.livraison,
  });
  if (error || !bon) throw new Erreur(409, error?.message?.replace(/^.*?: /, '') || 'Réservation impossible.');

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      customer_email: u.email ?? undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: centimes(bon.montant_bloque),
          product_data: { name: 'Réservation ' + bon.code + ' (montant maximum)', description: 'Seul le poids réel pesé devant vous est débité ; le reste est libéré.' },
        },
      }],
      payment_intent_data: {
        capture_method: 'manual', // empreinte : capture à la pesée
        transfer_data: { destination: prive.stripe_compte },
        metadata: { bon_code: bon.code, bon_id: bon.id },
        description: 'Pêche Connect ' + bon.code,
      },
      metadata: { bon_code: bon.code, bon_id: bon.id },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // le poisson est remis en vente après 30 min sans paiement
      success_url: site() + '/bon/' + bon.code + '?paye=1',
      cancel_url: site() + '/panier?annule=' + bon.code,
    });
    await db.from('bons').update({ stripe_session: session.id }).eq('id', bon.id);
    return { code: bon.code, url: session.url, montantBloque: bon.montant_bloque };
  } catch (err) {
    await db.rpc('annuler_bon', { p_code: bon.code }); // remet le poisson en vente
    throw err;
  }
});
