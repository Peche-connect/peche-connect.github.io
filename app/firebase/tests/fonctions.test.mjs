// Tests des fonctions serveur de bout en bout : émulateurs Firebase (connexion, base, fichiers, fonctions)
// + « stripe-mock » (copie locale de Stripe sur le port 12111).
// Lancement : firebase emulators:exec --only auth,firestore,storage,functions "npm --prefix tests run fonctions"
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import Stripe from 'stripe';

process.env.GCLOUD_PROJECT ||= 'demo-peche-connect';
const PROJET = process.env.GCLOUD_PROJECT;
const require = createRequire(import.meta.url);
const { db, Timestamp } = require('../functions/lib/commun.js');
const { lancerTaches } = require('../functions/lib/taches.js');
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:';
const FONCTIONS = `http://127.0.0.1:5001/${PROJET}/europe-west9/`;
const WHSEC = 'whsec_test_peche_connect';
const stripe = new Stripe('sk_test_123', { apiVersion: '2025-02-24.acacia' });

const comptes = {};
async function compte(nom) { // crée (ou reconnecte, pour relire les droits) un utilisateur de test
  const email = nom + '@test.peche-connect.fr';
  const url = AUTH + (comptes[nom] ? 'signInWithPassword' : 'signUp') + '?key=fausse-cle';
  const r = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'motdepasse123', returnSecureToken: true }) })).json();
  comptes[nom] = { uid: r.localId, jeton: r.idToken };
  return comptes[nom];
}
async function appeler(nom, fonction, data) {
  const r = await fetch(FONCTIONS + fonction, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + comptes[nom].jeton }, body: JSON.stringify({ data }) });
  const j = await r.json();
  if (j.error) { const e = new Error(j.error.message); e.statut = j.error.status; throw e; }
  return j.result;
}
async function webhook(evenement, secret = WHSEC) {
  const corps = JSON.stringify({ id: 'evt_' + Date.now(), object: 'event', api_version: '2025-02-24.acacia', ...evenement });
  return fetch(FONCTIONS + 'stripeWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripe.webhooks.generateTestHeaderString({ payload: corps, secret }) }, body: corps });
}
async function attendre(f, ms = 15000) { // les déclencheurs (triggers) tournent en arrière-plan
  const fin = Date.now() + ms;
  for (;;) { const v = await f(); if (v) return v; if (Date.now() > fin) return v; await new Promise((r) => setTimeout(r, 300)); }
}
const lire = async (chemin) => (await db.doc(chemin).get()).data();

let etalId, code, code2;

describe('Inscription et mise en vente', () => {
  test('un pêcheur s’inscrit : étal en attente de vérification', async () => {
    await compte('pecheur');
    const r = await appeler('pecheur', 'choisirRole', { role: 'pecheur', prenom: 'Jean-Marc', pecheur: { port: 'Le Robert', bateau: 'Ti Moun', immatriculation: 'mq 123456' } });
    etalId = r.etalId;
    const e = await lire('etals/' + etalId);
    assert.equal(e.statut, 'en_attente'); assert.equal(e.stripePret, false);
    assert.equal((await lire('etals/' + etalId + '/prive/infos')).immatriculation, 'MQ 123456');
  });
  test('il ne peut pas publier avant la vérification', async () => {
    await assert.rejects(appeler('pecheur', 'publierArrivage', { lignes: [{ espece: 'Thon jaune', prixKg: 14, dispoKg: 10 }] }), /pas encore vérifié/);
  });
  test('l’administration le vérifie : ses droits suivent automatiquement', async () => {
    await db.doc('comptesStripe/' + etalId).set({ compte: 'acct_1032D82eZvKYlo2C' });
    await db.doc('etals/' + etalId).update({ statut: 'verifie', stripePret: true });
    const ok = await attendre(async () => { const c = await compte('pecheur'); const p = JSON.parse(Buffer.from(c.jeton.split('.')[1], 'base64url')); return p.verifie === true; });
    assert.ok(ok, 'droit « verifie » posé');
  });
  test('il publie son arrivage', async () => {
    const r = await appeler('pecheur', 'publierArrivage', { lignes: [
      { espece: 'Thon jaune', prixKg: 14, dispoKg: 10, preparations: [{ nom: 'Entier', supplementKg: 0 }, { nom: 'En tranches', supplementKg: 2 }] },
      { espece: 'Vivaneau', prixKg: 16, dispoKg: 0 }] });
    assert.equal(r.produits, 1); // le vivaneau à 0 kg n'est pas mis en vente
  });
  test('une espèce en période de fermeture est refusée', async () => {
    await db.doc('fermetures/test').set({ espece: 'Colas', debut: '01-01', fin: '12-31', motif: 'Zone fermée (test)' });
    await assert.rejects(appeler('pecheur', 'publierArrivage', { lignes: [{ espece: 'Colas', prixKg: 11, dispoKg: 5 }] }), /Vente fermée : Colas/);
  });
  test('prix aberrant refusé', async () => {
    await assert.rejects(appeler('pecheur', 'publierArrivage', { lignes: [{ espece: 'Thon jaune', prixKg: 9999, dispoKg: 5 }] }), /invalide/);
  });
});

describe('Réservation et paiement', () => {
  test('un client réserve : stock retiré, page de paiement Stripe', async () => {
    await compte('client'); await compte('autre');
    await appeler('client', 'choisirRole', { role: 'client', prenom: 'Sophie' });
    await appeler('autre', 'choisirRole', { role: 'client', prenom: 'Marc' });
    const produit = (await lire('etals/' + etalId)).produits[0];
    const r = await appeler('client', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 1.5, preparation: 'En tranches' }], creneau: 'Avant 10 h' });
    code = r.code;
    assert.match(code, /^R-\d+$/); assert.ok(r.url, 'lien de paiement');
    const b = await lire('bons/' + code);
    assert.equal(b.statut, 'en_attente_paiement'); assert.equal(b.montantBloque, 27.3);
    assert.equal((await lire('etals/' + etalId)).produits[0].dispoKg, 8.5);
  });
  test('impossible de réserver plus que le stock', async () => {
    const produit = (await lire('etals/' + etalId)).produits[0];
    await assert.rejects(appeler('autre', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 50, preparation: 'Entier' }], creneau: 'Avant 10 h' }), /Plus assez de thon jaune/);
  });
  test('un faux « paiement réussi » est rejeté', async () => {
    const r = await webhook({ type: 'checkout.session.completed', data: { object: { id: 'cs_faux', object: 'checkout.session', status: 'complete', payment_intent: 'pi_faux', metadata: { code } } } }, 'whsec_pirate');
    assert.equal(r.status, 400);
    assert.equal((await lire('bons/' + code)).statut, 'en_attente_paiement');
  });
  test('le vrai message de Stripe confirme le paiement', async () => {
    const r = await webhook({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', object: 'checkout.session', status: 'complete', payment_intent: 'pi_1', metadata: { code } } } });
    assert.equal(r.status, 200);
    assert.equal((await lire('bons/' + code)).statut, 'reserve');
    assert.ok(await lire('acces/' + etalId + '_' + comptes.client.uid), 'adresse débloquée');
    const conv = await lire('conversations/' + etalId + '_' + comptes.client.uid);
    assert.deepEqual(conv.participants.sort(), [comptes.client.uid, comptes.pecheur.uid].sort());
  });
  test('le QR signé n’est donné qu’au client du bon', async () => {
    const { signature } = await appeler('client', 'monQr', { code });
    assert.ok(signature && signature.length > 10);
    assert.equal((await appeler('autre', 'monQr', { code })).signature, null);
    const v = await appeler('pecheur', 'verifierBon', { code, signature });
    assert.equal(v.valide, true); assert.equal(v.client, 'Sophie');
    await assert.rejects(appeler('pecheur', 'verifierBon', { code, signature: 'fabrique' + signature.slice(8) }), /non valable/);
  });
  test('un autre client ne peut pas valider la pesée', async () => {
    await assert.rejects(appeler('autre', 'validerPesee', { code, poids: [1.4] }), /pas pour votre étal/);
  });
  test('pesée : seul le poids réel est encaissé', async () => {
    const r = await appeler('pecheur', 'validerPesee', { code, poids: [1.4] });
    assert.equal(r.montantPaye, 23.3);
    const b = await lire('bons/' + code);
    assert.equal(b.statut, 'retire'); assert.equal(b.montantPaye, 23.3);
  });
  test('un bon déjà retiré ne se pèse pas deux fois', async () => {
    await assert.rejects(appeler('pecheur', 'validerPesee', { code, poids: [1.4] }), /déjà clôturé/);
  });
});

describe('Messagerie', () => {
  test('un numéro de téléphone tapé est masqué par le serveur', async () => {
    const conv = etalId + '_' + comptes.client.uid;
    const ref = await db.collection('conversations/' + conv + '/messages').add({ auteurId: comptes.client.uid, auteur: 'client', texte: 'Appelez-moi au 0696 12 34 56', creeLe: Timestamp.now() });
    const ok = await attendre(async () => !(await ref.get()).data().texte.includes('0696'));
    assert.ok(ok, 'numéro masqué');
    assert.equal((await lire('conversations/' + conv)).luPecheur, false);
  });
});

describe('Besoins des professionnels', () => {
  test('un pêcheur accepte le besoin d’un pro : commande à régler', async () => {
    await compte('pro');
    await appeler('pro', 'choisirRole', { role: 'pro', prenom: 'Arlette', pro: { raison: 'Chez Tante Arlette', type: 'Restaurant', siret: '123 456 789 00012', commune: 'Le Robert' } });
    const d = await db.collection('demandes').add({ proId: comptes.pro.uid, proRaison: 'Chez Tante Arlette', proType: 'Restaurant', proCommune: 'Le Robert', espece: 'Thon jaune', kg: 15, prixMaxKg: 13, pour: 'Demain', statut: 'ouverte', creeLe: Timestamp.now() });
    const r = await appeler('pecheur', 'accepterDemande', { id: d.id });
    code2 = r.code;
    const b = await lire('bons/' + code2);
    assert.equal(b.statut, 'en_attente_paiement'); assert.equal(b.origine, 'demande'); assert.equal(b.pro.siret, '12345678900012');
    assert.equal((await lire('demandes/' + d.id)).statut, 'acceptee');
    await assert.rejects(appeler('pecheur', 'accepterDemande', { id: d.id }), /déjà été pris/);
  });
  test('le pro obtient son lien de paiement', async () => {
    assert.ok((await appeler('pro', 'payerBon', { code: code2 })).url);
    await assert.rejects(appeler('client', 'payerBon', { code: code2 }), /introuvable/);
  });
});

describe('Tâches automatiques', () => {
  test('positions expirées effacées, paiements abandonnés remis en vente', async () => {
    const conv = etalId + '_' + comptes.client.uid;
    const m = await db.collection('conversations/' + conv + '/messages').add({ auteurId: comptes.pecheur.uid, auteur: 'pecheur', position: { libelle: 'x', lat: 1, lon: 1 }, positionExpireLe: Timestamp.fromMillis(Date.now() - 60000), creeLe: Timestamp.now() });
    const produit = (await lire('etals/' + etalId)).produits[0];
    const { code: c3 } = await appeler('autre', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 2, preparation: 'Entier' }], creneau: 'Avant 10 h' });
    await db.doc('bons/' + c3).update({ creeLe: Timestamp.fromMillis(Date.now() - 2 * 3600_000) });
    const avant = (await lire('etals/' + etalId)).produits[0].dispoKg;
    const bilan = await lancerTaches();
    assert.ok(bilan.positions >= 1 && bilan.abandons >= 1, JSON.stringify(bilan));
    assert.equal((await m.get()).data().position, undefined);
    assert.equal((await lire('bons/' + c3)).statut, 'annule');
    assert.equal((await lire('etals/' + etalId)).produits[0].dispoKg, Math.round((avant + 2) * 10) / 10);
  });
});

describe('Mon compte (RGPD)', () => {
  test('télécharger mes données', async () => {
    const d = await appeler('client', 'compte', { action: 'exporter' });
    assert.equal(d.profil.prenom, 'Sophie'); assert.equal(d.bons.length, 1); assert.ok(d.conversations[0].messages.length >= 2);
  });
  test('supprimer mon compte : bons gardés mais anonymisés, messages effacés', async () => {
    await appeler('client', 'compte', { action: 'supprimer' });
    const b = await lire('bons/' + code);
    assert.equal(b.clientId, null); assert.equal(b.clientPrenom, 'Compte supprimé');
    assert.equal(await lire('profils/' + comptes.client.uid), undefined);
    assert.equal(await lire('conversations/' + etalId + '_' + comptes.client.uid), undefined);
  });
});
