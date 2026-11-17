// Messages envoyés par Stripe (paiement accepté, abandonné, compte pêcheur prêt…).
// SÉCURITÉ : chaque message est vérifié avec sa signature ; un faux « paiement réussi » est rejeté.
import { onRequest } from 'firebase-functions/v2/https';
import Stripe from 'stripe';
import { db, FieldValue, QR_SECRET, REGION, stripe, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET_CONNECT, Timestamp, alerte } from './commun';
import { notifier } from './notifier';
import { signerBon } from './regles';
import { annulerBon, ouvrirConversation } from './reservations';

function verifier(corps: Buffer, signature: string): Stripe.Event {
  // deux secrets possibles : compte de la plateforme et comptes connectés des pêcheurs
  const secrets = [STRIPE_WEBHOOK_SECRET.value(), STRIPE_WEBHOOK_SECRET_CONNECT.value()].filter((s) => s && s !== '-');
  for (const s of secrets) {
    try { return stripe().webhooks.constructEvent(corps, signature, s); } catch { /* secret suivant */ }
  }
  throw new Error('signature invalide');
}

export const stripeWebhook = onRequest({ region: REGION, secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET_CONNECT, QR_SECRET] }, async (req, res) => {
  let ev: Stripe.Event;
  try {
    const sig = req.get('stripe-signature');
    if (req.method !== 'POST' || !sig) throw new Error('pas de signature');
    ev = verifier(req.rawBody, sig);
  } catch (e) {
    await alerte(null, 'webhook stripe rejeté', { raison: String(e), ip: req.ip ?? null });
    res.status(400).send('Signature invalide');
    return;
  }

  try {
    switch (ev.type) {
      case 'checkout.session.completed': {
        const s = ev.data.object;
        const code = s.metadata?.code;
        if (!code || s.status !== 'complete') break;
        const paiement = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null;
        const b = await db.runTransaction(async (t) => {
          const ref = db.doc('bons/' + code); const bon = (await t.get(ref)).data();
          if (!bon || bon.statut !== 'en_attente_paiement') return null; // déjà traité (Stripe peut renvoyer un message)
          t.update(ref, { statut: 'reserve', payeLe: FieldValue.serverTimestamp() });
          t.set(db.doc('bonsSecrets/' + code), { stripePaiement: paiement, signature: signerBon(QR_SECRET.value(), code, code) }, { merge: true });
          // adresse exacte du pêcheur débloquée pour ce client, jusqu'au lendemain
          t.set(db.doc('acces/' + bon.etalId + '_' + bon.clientId), { jusqua: Timestamp.fromMillis(Date.now() + 36 * 3600_000) });
          return bon;
        });
        if (!b) break;
        await ouvrirConversation(b.etalId, b.pecheurId, b.clientId, b.clientPrenom, code,
          { auteur: 'systeme', texte: 'Réservation ' + code + ' payée. La messagerie est ouverte jusqu’au retrait.' });
        await notifier([b.pecheurId], 'Nouvelle réservation ' + code, b.clientPrenom + ' · ' + b.creneau, { lien: '/(pecheur)/reservations' });
        break;
      }
      case 'checkout.session.expired': {
        // paiement abandonné : poisson remis en vente, seulement si c'est la page de paiement en cours du bon
        // (un lien relancé par « Payer » remplace l'ancien ; une commande de pro reste valable 24 h)
        const s = ev.data.object;
        const code = s.metadata?.code;
        if (!code || s.metadata?.relance === '1') break;
        const secrets = (await db.doc('bonsSecrets/' + code).get()).data();
        if (secrets?.stripeSession === s.id) await annulerBon(code);
        break;
      }
      case 'payment_intent.canceled': {
        const code = ev.data.object.metadata?.code;
        if (!code) break;
        const ref = db.doc('bons/' + code); const b = (await ref.get()).data();
        if (b && ['reserve', 'en_livraison'].includes(b.statut)) await ref.update({ statut: 'annule' });
        break;
      }
      case 'account.updated': {
        // compte de paiement du pêcheur prêt quand Stripe a tout vérifié
        const a = ev.data.object;
        const q = await db.collection('comptesStripe').where('compte', '==', a.id).limit(1).get();
        if (!q.empty) await db.doc('etals/' + q.docs[0].id).update({ stripePret: !!(a.charges_enabled && a.payouts_enabled) });
        break;
      }
    }
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur'); // Stripe réessaiera
    return;
  }
  res.json({ recu: true });
});
