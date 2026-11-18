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
const { getAuth } = createRequire(new URL('../functions/package.json', import.meta.url))('firebase-admin/auth'); // même copie que l'appli initialisée par commun.js
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:';
const FONCTIONS = `http://127.0.0.1:5001/${PROJET}/europe-west9/`;
const WHSEC = 'whsec_test_peche_connect';
const stripe = new Stripe('sk_test_123', { apiVersion: '2025-02-24.acacia' });

const comptes = {};
async function compte(nom, emailConfirme = true) { // crée (ou reconnecte, pour relire les droits) un utilisateur de test
  const email = nom + '@test.peche-connect.fr';
  const entrer = async (action) => (await (await fetch(AUTH + action + '?key=fausse-cle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'motdepasse123', returnSecureToken: true }) })).json());
  let r = await entrer(comptes[nom] ? 'signInWithPassword' : 'signUp');
  if (!comptes[nom] && emailConfirme) { await getAuth().updateUser(r.localId, { emailVerified: true }); r = await entrer('signInWithPassword'); }
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
  test('espèce ou préparation hors liste refusée (pas de texte libre : pas de numéro caché)', async () => {
    await assert.rejects(appeler('pecheur', 'publierArrivage', { lignes: [{ espece: 'Thon 0696123456', prixKg: 14, dispoKg: 5 }] }), /Espèce inconnue/);
    await assert.rejects(appeler('pecheur', 'publierArrivage', { lignes: [{ espece: 'Thon jaune', prixKg: 14, dispoKg: 5, preparations: [{ nom: 'Appelez le 0696', supplementKg: 0 }] }] }), /Préparation inconnue/);
  });
  test('prix aberrant refusé', async () => {
    await assert.rejects(appeler('pecheur', 'publierArrivage', { lignes: [{ espece: 'Thon jaune', prixKg: 9999, dispoKg: 5 }] }), /invalide/);
  });
});

describe('Réservation et paiement', () => {
  test('e-mail non confirmé : réservation refusée', async () => {
    await compte('inconnu', false);
    await appeler('inconnu', 'choisirRole', { role: 'client', prenom: 'Inconnu' });
    const produit = (await lire('etals/' + etalId)).produits[0];
    await assert.rejects(appeler('inconnu', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 1, preparation: 'Entier' }], creneau: 'Avant 10 h' }), /Confirmez votre adresse e-mail/);
  });
  test('un client réserve : stock retiré, page de paiement Stripe', async () => {
    await compte('client'); await compte('autre');
    await appeler('client', 'choisirRole', { role: 'client', prenom: 'Sophie' });
    await appeler('autre', 'choisirRole', { role: 'client', prenom: 'Marc' });
    const produit = (await lire('etals/' + etalId)).produits[0];
    const r = await appeler('client', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 1.5, preparation: 'En tranches' }], creneau: 'Appelez 0696123456' });
    code = r.code;
    assert.equal((await lire('bons/' + code)).creneau, 'Avant 10 h', 'créneau pris dans la liste, jamais en texte libre');
    assert.match(code, /^R-\d+$/); assert.ok(r.url, 'lien de paiement');
    const b = await lire('bons/' + code);
    assert.equal(b.statut, 'en_attente_paiement'); assert.equal(b.montantBloque, 27.3);
    assert.equal((await lire('etals/' + etalId)).produits[0].dispoKg, 8.5);
  });
  test('quantité plafonnée pour un particulier', async () => {
    const produit = (await lire('etals/' + etalId)).produits[0];
    await assert.rejects(appeler('autre', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 8.5, preparation: 'Entier' }, { produitId: produit.id, kg: 8, preparation: 'Entier' }], creneau: 'Avant 10 h' }), /Plus assez|Au plus 10 kg/);
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
  test('un paiement au mauvais montant ou sur une autre page est refusé', async () => {
    const sid = (await lire('bonsSecrets/' + code)).stripeSession;
    await webhook({ type: 'checkout.session.completed', data: { object: { id: sid, object: 'checkout.session', status: 'complete', amount_total: 100, payment_intent: 'pi_x', metadata: { code } } } });
    await webhook({ type: 'checkout.session.completed', data: { object: { id: 'cs_autre', object: 'checkout.session', status: 'complete', amount_total: 2730, payment_intent: 'pi_y', metadata: { code } } } });
    assert.equal((await lire('bons/' + code)).statut, 'en_attente_paiement');
  });
  test('le vrai message de Stripe confirme le paiement', async () => {
    const sid = (await lire('bonsSecrets/' + code)).stripeSession;
    const r = await webhook({ type: 'checkout.session.completed', data: { object: { id: sid, object: 'checkout.session', status: 'complete', amount_total: 2730, payment_intent: 'pi_1', metadata: { code } } } });
    assert.equal(r.status, 200);
    assert.equal((await lire('bons/' + code)).statut, 'reserve');
    assert.ok(await lire('acces/' + etalId + '_' + comptes.client.uid), 'adresse débloquée');
    const conv = await lire('conversations/' + etalId + '_' + comptes.client.uid);
    assert.deepEqual(conv.participants.sort(), [comptes.client.uid, comptes.pecheur.uid].sort());
  });
  let qr;
  test('le QR signé et le code de retrait ne sont donnés qu’au client du bon', async () => {
    qr = await appeler('client', 'monQr', { code });
    assert.ok(qr.signature && qr.signature.length > 10); assert.match(qr.codeRetrait, /^\d{6}$/);
    assert.deepEqual(await appeler('autre', 'monQr', { code }), { signature: null, codeRetrait: null });
    const v = await appeler('pecheur', 'verifierBon', { code, signature: qr.signature });
    assert.equal(v.valide, true); assert.equal(v.client, 'Sophie');
    assert.equal((await appeler('pecheur', 'verifierBon', { code, signature: qr.codeRetrait })).valide, true);
    await assert.rejects(appeler('pecheur', 'verifierBon', { code, signature: 'fabrique' + qr.signature.slice(8) }), /non valable/);
  });
  test('un autre client ne peut pas valider la pesée', async () => {
    await assert.rejects(appeler('autre', 'validerPesee', { code, poids: [1.4], preuve: qr.signature }), /introuvable/);
  });
  test('sans le QR ni le code du client, pas d’encaissement', async () => {
    await assert.rejects(appeler('pecheur', 'validerPesee', { code, poids: [1.4] }), /non valable/);
    await assert.rejects(appeler('pecheur', 'validerPesee', { code, poids: [1.4], preuve: qr.codeRetrait === '000000' ? '000001' : '000000' }), /non valable/);
    assert.equal((await lire('bons/' + code)).statut, 'reserve');
  });
  test('pesée avec le code de retrait : seul le poids réel est encaissé', async () => {
    const r = await appeler('pecheur', 'validerPesee', { code, poids: [1.4], preuve: qr.codeRetrait });
    assert.equal(r.montantPaye, 23.3);
    const b = await lire('bons/' + code);
    assert.equal(b.statut, 'retire'); assert.equal(b.montantPaye, 23.3);
    assert.equal((await appeler('client', 'monQr', { code })).signature, null, 'QR périmé après le retrait');
  });
  test('un bon déjà retiré ne se pèse pas deux fois', async () => {
    await assert.rejects(appeler('pecheur', 'validerPesee', { code, poids: [1.4], preuve: qr.codeRetrait }), /déjà clôturé/);
  });
});

describe('Messagerie', () => {
  const conv = () => etalId + '_' + comptes.client.uid;
  test('un numéro de téléphone tapé est masqué AVANT d’être enregistré', async () => {
    const r = await appeler('client', 'envoyerMessage', { conv: conv(), texte: 'Appelez-moi au 0 6 9 6 / 12.34.56' });
    assert.equal(r.masque, true);
    const tous = (await db.collection('conversations/' + conv() + '/messages').get()).docs.map((d) => d.data().texte ?? '');
    assert.ok(!tous.some((t) => /12.?34.?56/.test(t)), 'aucune trace du numéro en base');
    assert.ok(await attendre(async () => (await lire('conversations/' + conv())).luPecheur === false), 'pêcheur prévenu');
  });
  test('un inconnu ne peut pas écrire dans la conversation', async () => {
    await assert.rejects(appeler('autre', 'envoyerMessage', { conv: conv(), texte: 'Bonjour' }), /introuvable/);
  });
  test('position hors de Martinique refusée, position valable acceptée', async () => {
    await assert.rejects(appeler('pecheur', 'envoyerMessage', { conv: conv(), position: { libelle: 'x', lat: 1, lon: 1 } }), /hors de Martinique/);
    await assert.rejects(appeler('client', 'envoyerMessage', { conv: conv(), position: { libelle: 'x', lat: 14.6, lon: -61 } }), /vide/);
    assert.equal((await appeler('pecheur', 'envoyerMessage', { conv: conv(), position: { libelle: 'Ponton', lat: 14.68, lon: -60.94 }, expireLe: Date.now() + 3600_000 })).ok, true);
  });
  test('message vocal qui n’existe pas refusé', async () => {
    await assert.rejects(appeler('client', 'envoyerMessage', { conv: conv(), audio: { chemin: conv() + '/absent.m4a', duree: 5 } }), /introuvable/);
    await assert.rejects(appeler('client', 'envoyerMessage', { conv: 'autre_conv', audio: { chemin: conv() + '/x.m4a', duree: 5 } }), /introuvable/);
  });
  test('conversation fermée après le retrait', async () => {
    assert.ok((await lire('conversations/' + conv())).fermeeLe, 'date de fermeture posée par la pesée');
    await db.doc('conversations/' + conv()).update({ fermeeLe: Timestamp.fromMillis(Date.now() - 1000) });
    await assert.rejects(appeler('client', 'envoyerMessage', { conv: conv(), texte: 'Encore là ?' }), /fermée/);
    await db.doc('conversations/' + conv()).update({ fermeeLe: null });
  });
});

describe('Besoins des professionnels', () => {
  test('un pêcheur accepte le besoin d’un pro : commande à régler', async () => {
    await compte('pro');
    await appeler('pro', 'choisirRole', { role: 'pro', prenom: 'Arlette', pro: { raison: 'Chez Tante Arlette', type: 'Restaurant', siret: '123 456 789 00012', commune: 'Le Robert' } });
    await compte('pro'); // relire le rôle « pro »
    await assert.rejects(appeler('pro', 'posterDemande', { espece: 'Thon 0696', kg: 15, prixMaxKg: 13, pour: 'Demain' }), /Espèce inconnue/);
    await assert.rejects(appeler('client', 'posterDemande', { espece: 'Thon jaune', kg: 15, prixMaxKg: 13, pour: 'Demain' }), /professionnels/);
    const { id } = await appeler('pro', 'posterDemande', { espece: 'Thon jaune', kg: 15, prixMaxKg: 13, pour: 'Demain', note: 'Rappelez au 0696 12 34 56' });
    const dem = await lire('demandes/' + id);
    assert.equal(dem.proRaison, 'Chez Tante Arlette'); assert.ok(!dem.note.includes('0696'), 'note masquée');
    const d = { id };
    const r = await appeler('pecheur', 'accepterDemande', { id: d.id });
    code2 = r.code;
    const b = await lire('bons/' + code2);
    assert.equal(b.statut, 'en_attente_paiement'); assert.equal(b.origine, 'demande'); assert.equal(b.pro.siret, '12345678900012');
    assert.equal((await lire('demandes/' + d.id)).statut, 'acceptee');
    await assert.rejects(appeler('pecheur', 'accepterDemande', { id: d.id }), /déjà été pris/);
    assert.equal(await lire('conversations/' + etalId + '_' + comptes.pro.uid), undefined, 'messagerie ouverte seulement après paiement');
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
    await db.doc('bonsSecrets/' + c3).update({ sessionExpireLe: Timestamp.fromMillis(Date.now() - 60_000) }); // page de paiement fermée
    const avant = (await lire('etals/' + etalId)).produits[0].dispoKg;
    const bilan = await lancerTaches();
    assert.ok(bilan.positions >= 1 && bilan.abandons >= 1, JSON.stringify(bilan));
    assert.equal((await m.get()).data().position, undefined);
    assert.equal((await lire('bons/' + c3)).statut, 'annule');
    assert.equal((await lire('etals/' + etalId)).produits[0].dispoKg, Math.round((avant + 2) * 10) / 10);
  });
});

describe('Protections contre les abus', () => {
  test('pas plus de 2 réservations non payées à la fois', async () => {
    const produit = (await lire('etals/' + etalId)).produits[0];
    const resa = () => appeler('autre', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 0.1, preparation: 'Entier' }], creneau: 'Avant 10 h' });
    await resa(); await resa();
    await assert.rejects(resa(), /déjà 2 réservations en attente/);
  });
  test('cadence limitée par action (robot qui insiste)', async () => {
    await compte('robot');
    for (let i = 0; i < 10; i++) await appeler('robot', 'choisirRole', { role: 'client', prenom: 'Robot' + i });
    await assert.rejects(appeler('robot', 'choisirRole', { role: 'client', prenom: 'Robot' }), /Trop de demandes/);
  });
  test('messages en rafale bloqués', async () => {
    const conv = etalId + '_' + comptes.client.uid;
    let refus = 0;
    for (let i = 0; i < 32; i++) { try { await appeler('client', 'envoyerMessage', { conv, texte: 'spam ' + i }); } catch (e) { if (/Trop de demandes/.test(e.message)) refus++; } }
    assert.ok(refus >= 1, 'cadence limitée (' + refus + ' refus)');
  });
  test('un pêcheur vérifié qui change d’immatriculation repasse en vérification', async () => {
    await appeler('pecheur', 'choisirRole', { role: 'pecheur', prenom: 'Jean-Marc', pecheur: { port: 'Le Robert', bateau: 'Ti Moun', immatriculation: 'MQ 999999' } });
    assert.equal((await lire('etals/' + etalId)).statut, 'en_attente');
    await db.doc('etals/' + etalId).update({ statut: 'verifie' }); // remis pour la suite
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
