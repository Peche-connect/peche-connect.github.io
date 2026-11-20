// Messages envoyés par Stripe (paiement accepté, abandonné, compte pêcheur prêt…).
// SÉCURITÉ : chaque message est vérifié avec sa signature ; un faux « paiement réussi » est rejeté.
import { onRequest } from 'firebase-functions/v2/https';
import Stripe from 'stripe';
import { logger } from 'firebase-functions';
import { alerte, centimes, CODE_BON_OK, db, FieldValue, REGION, stripe, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET_CONNECT, Timestamp } from './commun';
import { notifier } from './notifier';
import { ajouterEtape } from './historique';
import { nouveauNonce } from './regles';
import { annulerBon, ouvrirConversation } from './reservations';

function verifier(corps: Buffer, signature: string): Stripe.Event {
  // deux secrets possibles : compte de la plateforme et comptes connectés des pêcheurs
  const secrets = [STRIPE_WEBHOOK_SECRET.value(), STRIPE_WEBHOOK_SECRET_CONNECT.value()].filter((s) => s && s !== '-');
  for (const s of secrets) {
    try { return stripe().webhooks.constructEvent(corps, signature, s); } catch { /* secret suivant */ }
  }
  throw new Error('signature invalide');
}

export const stripeWebhook = onRequest({ region: REGION, secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET_CONNECT] }, async (req, res) => {
  let ev: Stripe.Event;
  try {
    const sig = req.get('stripe-signature');
    if (req.method !== 'POST' || !sig) throw new Error('pas de signature');
    ev = verifier(req.rawBody, sig);
  } catch (e) {
    // pas d'écriture en base pour chaque requête refusée (sinon n'importe qui ferait grimper la facture) :
    // une ligne dans les journaux Google suffit (alerte e-mail limitée par Cloud Monitoring)
    logger.warn('ALERTE_SECURITE webhook stripe rejeté', { raison: String(e).slice(0, 80), ip: req.ip ?? null });
    res.status(400).send('Signature invalide');
    return;
  }

  // même message reçu deux fois (Stripe réessaie tant qu'il n'a pas eu de réponse) : traité une seule fois
  const memo = db.doc('evenementsStripe/' + ev.id);
  if ((await memo.get()).exists) { res.json({ recu: true, deja: true }); return; }

  try {
    switch (ev.type) {
      case 'checkout.session.completed': {
        const s = ev.data.object;
        const code = s.metadata?.code;
        if (ev.account || !code || !CODE_BON_OK(code) || s.status !== 'complete') break; // les paiements viennent du compte de la plateforme, jamais d'un compte de pêcheur
        const paiement = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null;
        const b = await db.runTransaction(async (t) => {
          const ref = db.doc('bons/' + code); const bon = (await t.get(ref)).data();
          const secrets = (await t.get(db.doc('bonsSecrets/' + code))).data();
          // la page payée doit être celle que le serveur a créée pour ce bon, au bon montant
          if (!bon || !bon.clientId || secrets?.stripeSession !== s.id || s.amount_total !== centimes(bon.montantBloque)) {
            return { refus: true as const, statut: bon?.statut ?? 'inconnu' };
          }
          if (bon.statut !== 'en_attente_paiement') {
            return bon.statut === 'annule' ? { refus: true as const, statut: 'annule' } : null; // déjà traité (Stripe peut renvoyer un message)
          }
          t.update(ref, { statut: 'reserve', payeLe: FieldValue.serverTimestamp(),
            ...ajouterEtape(t, code, bon, 'payee', { uid: null, role: 'stripe' }, { montantBloque: bon.montantBloque, session: s.id }) });
          // secret propre à ce bon pour le QR et le code de retrait (effacé après le retrait)
          t.set(db.doc('bonsSecrets/' + code), { stripePaiement: paiement, nonce: nouveauNonce() }, { merge: true });
          // adresse exacte du pêcheur débloquée pour ce client, jusqu'au lendemain
          t.set(db.doc('acces/' + bon.etalId + '_' + bon.clientId), { jusqua: Timestamp.fromMillis(Date.now() + 36 * 3600_000) });
          return bon;
        });
        if (!b) break;
        if ('refus' in b) {
          // paiement qui ne correspond à aucun bon valable (bon annulé entre-temps, montant ou page inattendus) :
          // l'empreinte est libérée tout de suite, rien n'est débité
          await alerte(null, 'paiement Stripe refusé et libéré', { code, session: s.id, statut: b.statut, montant: s.amount_total });
          if (paiement) await stripe().paymentIntents.cancel(paiement).catch(() => {});
          break;
        }
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
        if (!code || !CODE_BON_OK(code) || s.metadata?.relance === '1') break;
        const secrets = (await db.doc('bonsSecrets/' + code).get()).data();
        if (secrets?.stripeSession === s.id) await annulerBon(code, 'page de paiement expirée');
        break;
      }
      case 'payment_intent.canceled': {
        const code = ev.data.object.metadata?.code;
        if (!code || !CODE_BON_OK(code)) break;
        await annulerBon(code, 'empreinte bancaire expirée ou annulée', { uid: null, role: 'stripe' });
        break;
      }
      case 'charge.refunded': {
        // remboursement (fait par l'équipe, ou directement depuis le tableau de bord Stripe) : noté sur le bon
        const ch = ev.data.object;
        const code = await codeDuPaiement(ch.metadata?.code, ch.payment_intent);
        if (!code) break;
        const rembourse = Math.round(ch.amount_refunded) / 100;
        await db.runTransaction(async (t) => {
          const ref = db.doc('bons/' + code); const b = (await t.get(ref)).data();
          if (!b || b.remboursementEnCours) return; // remboursement lancé par l'équipe : déjà noté
          if (Math.abs(Number(b.rembourse ?? 0) - rembourse) < 0.001) return;
          t.update(ref, { rembourse, ...(rembourse >= Number(b.montantPaye ?? 0) - 0.001 ? { statut: 'rembourse' } : {}),
            ...ajouterEtape(t, code, b, 'remboursee', { uid: null, role: 'stripe' }, { cumul: rembourse, origine: 'tableau de bord Stripe' }) });
        });
        break;
      }
      case 'charge.dispute.created':
      case 'charge.dispute.closed': {
        // contestation par la banque du client : la plateforme est débitée (+ 20 € de frais) ; l'équipe doit répondre
        const dp = ev.data.object;
        const pi = typeof dp.payment_intent === 'string' ? dp.payment_intent : dp.payment_intent?.id;
        const code = await codeDuPaiement(undefined, pi);
        const litige = { id: dp.id, statut: dp.status, montant: dp.amount / 100, raison: dp.reason, majLe: FieldValue.serverTimestamp() };
        if (code) {
          await db.runTransaction(async (t) => {
            const ref = db.doc('bons/' + code); const b = (await t.get(ref)).data();
            if (!b) return;
            t.update(ref, { litige, ...(ev.type === 'charge.dispute.created' ? ajouterEtape(t, code, b, 'litige', { uid: null, role: 'stripe' }, { montant: litige.montant, raison: dp.reason }) : {}) });
          });
        }
        if (ev.type === 'charge.dispute.created') {
          await db.collection('signalements').add({ conv: null, bonCode: code, par: null, contre: null, bloquer: false, traite: false, le: FieldValue.serverTimestamp(),
            motif: 'LITIGE BANCAIRE ' + (dp.amount / 100).toFixed(2) + ' € (' + dp.reason + ') : répondre dans le tableau de bord Stripe avant la date limite' });
        }
        await alerte(null, 'litige bancaire ' + dp.status, { code, litige: dp.id, montant: dp.amount / 100 });
        break;
      }
      case 'payout.failed': {
        // virement vers le pêcheur refusé par sa banque (RIB fermé…) : il doit corriger dans son compte de paiement
        if (!ev.account) break;
        const q = await db.collection('comptesStripe').where('compte', '==', ev.account).limit(1).get();
        if (q.empty) break;
        const etalId = q.docs[0].id;
        await db.doc('etals/' + etalId).update({ versementEchoue: true });
        const e = (await db.doc('etals/' + etalId).get()).data();
        if (e?.pecheurId) await notifier([e.pecheurId], 'Virement refusé par votre banque', 'Vérifiez votre RIB dans « Mon compte de paiement ». L’argent reste en attente chez Stripe.');
        await alerte(null, 'virement pêcheur échoué', { etalId, montant: ev.data.object.amount / 100 });
        break;
      }
      case 'payout.paid': {
        if (!ev.account) break;
        const q = await db.collection('comptesStripe').where('compte', '==', ev.account).limit(1).get();
        if (!q.empty) await db.doc('etals/' + q.docs[0].id).update({ versementEchoue: false });
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
    await alerte(null, 'webhook Stripe en échec (Stripe réessaiera)', { type: ev.type, id: ev.id, erreur: String(e).slice(0, 200) }).catch(() => null);
    res.status(500).send('Erreur'); // Stripe réessaiera
    return;
  }
  await memo.set({ type: ev.type, le: FieldValue.serverTimestamp() });
  res.json({ recu: true });
});

// Retrouve le bon d'un paiement : métadonnée du paiement (copiée par Stripe), sinon lecture du paiement
async function codeDuPaiement(code: string | undefined, paiement: string | Stripe.PaymentIntent | null | undefined) {
  if (code && CODE_BON_OK(code)) return code;
  const id = typeof paiement === 'string' ? paiement : paiement?.id;
  if (!id) return null;
  const pi = await stripe().paymentIntents.retrieve(id).catch(() => null);
  const c = pi?.metadata?.code;
  return c && CODE_BON_OK(c) ? c : null;
}
