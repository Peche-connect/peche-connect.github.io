// Tests des calculs et de la sécurité côté serveur : deno test --allow-env functions/tests/
import Stripe from 'npm:stripe@17.7.0';
import { montantBloque, montantsPesee } from '../_shared/montants.ts';
import { signatureValide, signerBon } from '../_shared/qr.ts';

const egal = (a: unknown, b: unknown, nom: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(nom + ' : ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); };
const r = { frais_service: 0.9, commission_pct: 0.05, marge_empreinte: 0.1, livraison_min_kg: 10, frais_livraison: 15 };

Deno.test('montant bloqué identique à l’appli (1,5 kg de thon en tranches)', () => {
  egal(montantBloque(r, [{ kg: 1.5, prixKg: 14, supplementKg: 2 }]), 27.3, 'empreinte');
});

Deno.test('pesée : total, part plateforme et part pêcheur', () => {
  const m = montantsPesee(r, [{ kg: 1.4, prixKg: 14, supplementKg: 2 }]);
  egal(m, { total: 23.3, plateforme: 2.02, pourLePecheur: 21.28 }, 'pesée');
  egal(montantsPesee({ ...r, commission_pct: 0 }, [{ kg: 1, prixKg: 10, supplementKg: 0 }], 15), { total: 25.9, plateforme: 15.9, pourLePecheur: 10 }, 'livraison');
});

Deno.test('QR signé : valide, et refusé si on change le code ou la signature', async () => {
  Deno.env.set('QR_SECRET', 'secret-de-test-tres-long-0123456789');
  const s = await signerBon('R-127', 'b0a1');
  egal(await signatureValide('R-127', 'b0a1', s), true, 'signature valide');
  egal(await signatureValide('R-128', 'b0a1', s), false, 'autre code');
  egal(await signatureValide('R-127', 'b0a1', s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')), false, 'signature trafiquée');
  Deno.env.set('QR_SECRET', 'autre-secret');
  egal(await signatureValide('R-127', 'b0a1', s), false, 'autre clé');
});

Deno.test('webhook Stripe : un faux « paiement réussi » est rejeté', async () => {
  const stripe = new Stripe('sk_test_x', { httpClient: Stripe.createFetchHttpClient() });
  const p = Stripe.createSubtleCryptoProvider();
  const corps = JSON.stringify({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: {} } });
  const bonne = await stripe.webhooks.generateTestHeaderStringAsync({ payload: corps, secret: 'whsec_vrai', cryptoProvider: p });
  egal((await stripe.webhooks.constructEventAsync(corps, bonne, 'whsec_vrai', undefined, p)).type, 'checkout.session.completed', 'vrai message');
  const fausse = await stripe.webhooks.generateTestHeaderStringAsync({ payload: corps, secret: 'whsec_pirate', cryptoProvider: p });
  let rejete = false;
  try { await stripe.webhooks.constructEventAsync(corps, fausse, 'whsec_vrai', undefined, p); } catch { rejete = true; }
  egal(rejete, true, 'faux message rejeté');
});
