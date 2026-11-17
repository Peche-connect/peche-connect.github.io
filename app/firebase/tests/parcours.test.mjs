// Parcours complet dans un vrai navigateur, sur le site construit en mode réel et branché sur les
// émulateurs Firebase (+ stripe-mock) : inscription et vérification d'un pêcheur, mise en vente,
// connexion d'un client par lien e-mail, réservation, paiement confirmé par Stripe, bon + QR,
// messages écrits et vocaux dans les deux sens, pesée par QR, export des données.
// Lancement (voir .github/workflows/verifications.yml) : site servi sur http://localhost:8091.
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { after, afterEach, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import Stripe from 'stripe';

process.env.GCLOUD_PROJECT ||= 'demo-peche-connect';
const PROJET = process.env.GCLOUD_PROJECT;
const SITE = 'http://localhost:8091';
const require = createRequire(import.meta.url);
const { db } = require('../functions/lib/commun.js');
const stripe = new Stripe('sk_test_123', { apiVersion: '2025-02-24.acacia' });

let navigateur, pecheur, client, code, etalId;
const erreurs = [];
async function page(nom) {
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'], acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erreurs.push(nom + ' : ' + e.message));
  // la page de paiement Stripe (factice) n'est pas ouverte : le paiement est simulé plus bas
  await ctx.route('https://checkout.stripe.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Paiement Stripe (test)</h1>' }));
  return p;
}
const texte = (p) => p.evaluate(() => document.body.innerText);
async function voir(p, t, ms = 15000) { await p.getByText(t, { exact: false }).first().waitFor({ timeout: ms }); }
async function lienEmail(email) { // lien de connexion « envoyé » par l'émulateur
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJET}/oobCodes`)).json();
    const c = (r.oobCodes ?? []).filter((x) => x.email === email && x.requestType === 'EMAIL_SIGNIN').pop();
    if (c) return SITE + '/connexion?mode=signIn&lang=fr&apiKey=fake&oobCode=' + c.oobCode;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error('pas de lien pour ' + email);
}
async function seConnecter(p, role, email, prenom) {
  await p.goto(SITE + '/connexion');
  await voir(p, 'Bienvenue');
  await p.getByText(role, { exact: true }).click();
  if (prenom) await p.getByPlaceholder('Ex. Sophie').fill(prenom);
  await p.getByLabel('Adresse e-mail').fill(email);
  await p.getByText('Recevoir un lien de connexion').click();
  await voir(p, 'Regardez vos e-mails');
  await p.goto(await lienEmail(email)); // même navigateur : connexion directe
}

before(async () => {
  navigateur = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  pecheur = await page('pêcheur'); client = await page('client');
});
// captures après chaque étape (gardées par GitHub pour vérifier visuellement)
let etape = 0;
afterEach(async () => {
  etape++; mkdirSync('/tmp/captures', { recursive: true });
  await Promise.all([pecheur?.screenshot({ path: `/tmp/captures/${etape}-pecheur.png` }).catch(() => {}), client?.screenshot({ path: `/tmp/captures/${etape}-client.png` }).catch(() => {})]);
});
after(async () => { await navigateur?.close(); });

describe('Parcours complet en mode réel', () => {
  test('un pêcheur s’inscrit par lien e-mail', async () => {
    await seConnecter(pecheur, 'Pêcheur', 'jeanmarc@test.peche-connect.fr');
    await voir(pecheur, 'Vendre sur Pêche Connect');
    await pecheur.getByPlaceholder('Ex. Jean-Marc').fill('Jean-Marc');
    await pecheur.getByPlaceholder('Ex. Yole Bèl Lanmè').fill('Ti Moun');
    await pecheur.getByPlaceholder('Ex. FF 890414').fill('MQ 123456');
    await pecheur.getByText('Envoyer mon dossier').click();
    await voir(pecheur, 'Dossier envoyé');
    const q = await db.collection('etals').where('prenom', '==', 'Jean-Marc').get();
    assert.equal(q.size, 1); etalId = q.docs[0].id;
    assert.equal(q.docs[0].data().statut, 'en_attente');
  });

  test('l’administration le vérifie, il publie son arrivage', async () => {
    await db.doc('comptesStripe/' + etalId).set({ compte: 'acct_1032D82eZvKYlo2C' });
    await db.doc('etals/' + etalId).update({ statut: 'verifie', stripePret: true });
    await new Promise((ok) => setTimeout(ok, 3000)); // droits mis à jour par le serveur
    await pecheur.reload();
    await pecheur.getByText('Publier mon premier arrivage').click({ timeout: 20000 });
    await voir(pecheur, 'Votre arrivage du jour');
    await pecheur.getByText('+ Ajouter une espèce').click();
    await pecheur.getByText('Thon jaune', { exact: true }).click();
    await pecheur.getByText('Mettre en vente').click();
    await voir(pecheur, 'Arrivage publié');
    assert.equal((await db.doc('etals/' + etalId).get()).data().produits[0].espece, 'Thon jaune');
  });

  test('un client se connecte par lien e-mail et voit l’étal', async () => {
    await seConnecter(client, 'Particulier', 'sophie@test.peche-connect.fr', 'Sophie');
    await voir(client, 'Étal de Jean-Marc', 20000);
  });

  test('il réserve : page de paiement Stripe, puis paiement confirmé', async () => {
    await client.getByText('Étal de Jean-Marc').first().click();
    await client.getByLabel('Ajouter Thon jaune').click();
    await client.getByText('Voir mon panier').last().click();
    await client.getByText('Réserver et payer').click();
    await client.waitForURL((u) => !String(u).includes('/panier'), { timeout: 20000 }); // départ vers la page de paiement
    const b = await db.collection('bons').where('etalId', '==', etalId).get();
    assert.equal(b.size, 1); code = b.docs[0].id;
    assert.equal(b.docs[0].data().statut, 'en_attente_paiement');
    // Stripe prévient le serveur que le paiement est accepté (message signé)
    const corps = JSON.stringify({ id: 'evt_e2e', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_e2e', object: 'checkout.session', status: 'complete', payment_intent: 'pi_e2e', metadata: { code } } } });
    const r = await fetch(`http://127.0.0.1:5001/${PROJET}/europe-west9/stripeWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripe.webhooks.generateTestHeaderString({ payload: corps, secret: 'whsec_test_peche_connect' }) }, body: corps });
    assert.equal(r.status, 200);
    await client.goto(SITE + '/bon/' + code + '?paye=1');
    await voir(client, 'C’est réservé', 20000);
    await voir(client, 'Débarcadère de Le Robert'); // adresse exacte débloquée après paiement
    await client.getByLabel('QR code du bon').waitFor();
  });

  test('messages écrits et vocaux dans les deux sens', async () => {
    await client.getByText('Message', { exact: true }).click();
    await voir(client, 'payée');
    await client.getByPlaceholder('Écrire à', { exact: false }).fill('Bonjour, j’arrive vers 9 h');
    await client.getByLabel('Envoyer', { exact: true }).click();
    await voir(client, 'j’arrive vers 9 h');
    await client.getByLabel('Enregistrer un message vocal').click();
    await client.waitForTimeout(2500);
    await client.getByLabel('Envoyer le message vocal').click();
    await client.getByLabel('Écouter le message vocal').first().waitFor({ timeout: 20000 });
    // côté pêcheur : la réservation et les deux messages arrivent
    await pecheur.goto(SITE + '/');
    await pecheur.getByText('Réservations', { exact: true }).last().click();
    await voir(pecheur, code, 20000);
    await pecheur.getByText('Messages', { exact: true }).last().click();
    await pecheur.getByText('Sophie').first().click({ timeout: 20000 });
    await voir(pecheur, 'j’arrive vers 9 h');
    await pecheur.getByLabel('Écouter le message vocal').first().click();
    await pecheur.getByLabel('Arrêter le message vocal').first().waitFor({ timeout: 10000 }); // le fichier privé se télécharge et se lit
    await pecheur.getByPlaceholder('Écrire à', { exact: false }).fill('Parfait, je suis à gauche de la cale');
    await pecheur.getByLabel('Envoyer', { exact: true }).click();
    await voir(client, 'je suis à gauche de la cale', 20000); // reçu en direct
  });

  test('pesée après scan du QR : seul le poids réel est encaissé', async () => {
    const sig = (await db.doc('bonsSecrets/' + code).get()).data().signature;
    await pecheur.goto(SITE + '/pesee/' + code + '?s=' + sig);
    await voir(pecheur, 'QR authentique', 20000);
    await pecheur.getByText('Valider la pesée', { exact: false }).click();
    await new Promise((ok) => setTimeout(ok, 3000));
    assert.equal((await db.doc('bons/' + code).get()).data().statut, 'retire');
    await client.goto(SITE + '/bons');
    await voir(client, 'Retiré · payé', 20000);
  });

  test('un faux QR est refusé', async () => {
    await pecheur.goto(SITE + '/pesee/' + code + '?s=FAUXFAUXFAUXFAUXFAUXFA');
    await voir(pecheur, 'non valable', 20000);
  });

  test('le client télécharge ses données', async () => {
    await client.goto(SITE + '/compte');
    const dl = client.waitForEvent('download');
    await client.getByText('Télécharger mes données').click();
    assert.match((await dl).suggestedFilename(), /mes-donnees/);
    await client.goto(SITE + '/legal/confidentialite');
    await voir(client, 'Politique de confidentialité');
  });

  test('aucune erreur JavaScript', () => { assert.deepEqual(erreurs, []); });
});
