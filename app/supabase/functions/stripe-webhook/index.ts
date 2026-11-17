// Messages envoyés par Stripe (paiement accepté, abandonné, compte pêcheur prêt…).
// SÉCURITÉ : chaque message est vérifié avec sa signature (secret « whsec_… ») ; un faux
// « paiement réussi » envoyé par un pirate est rejeté.
// À déployer sans vérification du jeton Supabase : `supabase functions deploy stripe-webhook --no-verify-jwt`.
import Stripe from 'npm:stripe@17.7.0';
import { notifier } from '../_shared/notifier.ts';
import { admin, env, journal, stripe } from '../_shared/outils.ts';
import { signerBon } from '../_shared/qr.ts';

const fournisseur = Stripe.createSubtleCryptoProvider();

async function verifier(corps: string, signature: string): Promise<Stripe.Event> {
  // Deux secrets possibles : compte de la plateforme et comptes connectés des pêcheurs
  const secrets = [env('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT') ?? ''].filter(Boolean);
  for (const s of secrets) {
    try { return await stripe().webhooks.constructEventAsync(corps, signature, s, undefined, fournisseur); } catch { /* secret suivant */ }
  }
  throw new Error('signature invalide');
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const corps = await req.text();
  let ev: Stripe.Event;
  try {
    if (!signature) throw new Error('pas de signature');
    ev = await verifier(corps, signature);
  } catch (e) {
    await journal(null, 'webhook stripe rejeté', { raison: String(e), ip: req.headers.get('x-forwarded-for') });
    return new Response('Signature invalide', { status: 400 });
  }

  const db = admin();
  try {
    switch (ev.type) {
      case 'checkout.session.completed': {
        const s = ev.data.object;
        const code = s.metadata?.bon_code; const id = s.metadata?.bon_id;
        if (!code || !id || s.status !== 'complete') break;
        const { data: bon } = await db.from('bons').select('*').eq('id', id).single();
        if (!bon || bon.statut !== 'en_attente_paiement') break; // déjà traité (Stripe peut renvoyer un message)
        await db.from('bons').update({
          statut: 'reserve', paye_le: new Date().toISOString(),
          stripe_paiement: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id,
          signature: await signerBon(code, id),
        }).eq('id', id);
        // ouvre la messagerie entre le client et le pêcheur
        const { data: conv } = await db.from('conversations').upsert(
          { etal_id: bon.etal_id, client_id: bon.client_id, client_prenom: bon.client_prenom, bon_code: code, lu_pecheur: false },
          { onConflict: 'etal_id,client_id' },
        ).select('id').single();
        if (conv) await db.from('messages').insert({ conversation_id: conv.id, auteur: 'systeme', texte: 'Réservation ' + code + ' payée. La messagerie est ouverte jusqu’au retrait.' });
        const { data: etal } = await db.from('etals').select('pecheur_id').eq('id', bon.etal_id).single();
        if (etal) await notifier([etal.pecheur_id], 'Nouvelle réservation ' + code, bon.client_prenom + ' · ' + bon.creneau, { lien: '/(pecheur)/reservations' });
        // une commande de pro issue d'un « besoin » : on la marque acceptée
        await db.from('demandes').update({ statut: 'acceptee' }).eq('bon_code', code);
        break;
      }
      case 'checkout.session.expired': {
        // paiement abandonné : le poisson est remis en vente, seulement si c'est la page de paiement en cours
        // du bon (un lien relancé par « Payer » remplace l'ancien) et pas une commande de pro (valable 24 h)
        const s = ev.data.object;
        const code = s.metadata?.bon_code;
        if (!code || s.metadata?.relance === '1') break;
        const { data: bon } = await db.from('bons').select('stripe_session').eq('code', code).single();
        if (bon?.stripe_session === s.id) await db.rpc('annuler_bon', { p_code: code });
        break;
      }
      case 'payment_intent.canceled': {
        // empreinte expirée ou annulée : le bon n'est plus valable
        const code = ev.data.object.metadata?.bon_code;
        if (code) await db.from('bons').update({ statut: 'annule' }).eq('code', code).in('statut', ['reserve', 'en_livraison']);
        break;
      }
      case 'account.updated': {
        // compte de paiement du pêcheur : prêt quand Stripe a tout vérifié
        const a = ev.data.object;
        const pret = !!(a.charges_enabled && a.payouts_enabled);
        const { data: p } = await db.from('etals_prive').select('etal_id').eq('stripe_compte', a.id).maybeSingle();
        if (p) await db.from('etals').update({ stripe_pret: pret }).eq('id', p.etal_id);
        break;
      }
    }
  } catch (e) {
    console.error(e);
    return new Response('Erreur', { status: 500 }); // Stripe réessaiera
  }
  return new Response(JSON.stringify({ recu: true }), { headers: { 'Content-Type': 'application/json' } });
});
