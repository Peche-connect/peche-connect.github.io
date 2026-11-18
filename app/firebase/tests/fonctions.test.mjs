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
const { verifierSuivi } = require('../functions/lib/historique.js');
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
    await assert.rejects(appeler('pecheur', 'choisirRole', { role: 'pecheur', prenom: 'Jean-Marc', pecheur: { port: 'Le Robert', bateau: 'Ti Moun', immatriculation: 'mq 123456' } }), /numéro de marin/i);
    const r = await appeler('pecheur', 'choisirRole', { role: 'pecheur', prenom: 'Jean-Marc', pecheur: { port: 'Le Robert', bateau: 'Ti Moun', immatriculation: 'mq 123456', numeroMarin: 'ab 1234-56' } });
    etalId = r.etalId;
    const e = await lire('etals/' + etalId);
    assert.equal(e.statut, 'en_attente'); assert.equal(e.stripePret, false);
    assert.equal((await lire('etals/' + etalId + '/prive/infos')).immatriculation, 'MQ 123456');
    const dossier = await lire('etals/' + etalId + '/verification/dossier');
    assert.equal(dossier.numeroMarin, 'AB123456'); assert.equal(dossier.numeroVerifie, false, 'vérifié à la main par l’équipe');
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
    const etapes = (await db.collection('bons/' + code + '/historique').orderBy('n').get()).docs.map((d) => d.data().etape);
    assert.deepEqual(etapes, ['reservee', 'payee', 'retiree'], 'pas de facture pour un particulier');
    assert.equal((await verifierSuivi(code)).valide, true);
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
  test('appel par Internet : jeton pour les deux personnes de la conversation seulement', async () => {
    const r = await appeler('client', 'jetonAppel', { conv: conv() });
    assert.match(r.jeton, /^007/); assert.match(r.canal, /^pc[0-9a-f]{40}$/); assert.equal(r.numero, 1); assert.equal(r.reponse, false);
    assert.equal((await lire('conversations/' + conv())).appelEnCours.par, comptes.client.uid, 'le pêcheur est prévenu');
    const msgs = (await db.collection('conversations/' + conv() + '/messages').get()).docs.map((d) => d.data().texte ?? '');
    assert.ok(msgs.some((t) => /a lancé un appel/.test(t)));
    const p = await appeler('pecheur', 'jetonAppel', { conv: conv() });
    assert.equal(p.canal, r.canal); assert.equal(p.numero, 2); assert.equal(p.reponse, true, 'le pêcheur répond, sans faire sonner le client');
    assert.equal((await lire('conversations/' + conv())).appelEnCours, undefined);
    await assert.rejects(appeler('autre', 'jetonAppel', { conv: conv() }), /introuvable/);
  });
  test('signaler une conversation, puis la bloquer', async () => {
    assert.equal((await appeler('client', 'signaler', { conv: conv(), motif: 'Propos déplacés' })).ok, true);
    await assert.rejects(appeler('autre', 'signaler', { conv: conv(), motif: 'x' }), /introuvable/);
    const s = (await db.collection('signalements').where('conv', '==', conv()).get()).docs.map((d) => d.data());
    assert.equal(s.length, 1); assert.equal(s[0].contre, comptes.pecheur.uid);
    const avant = (await lire('conversations/' + conv())).fermeeLe ?? null;
    await appeler('client', 'signaler', { conv: conv(), motif: 'Autre problème', bloquer: true });
    await assert.rejects(appeler('pecheur', 'envoyerMessage', { conv: conv(), texte: 'Allô ?' }), /fermée/);
    await assert.rejects(appeler('pecheur', 'jetonAppel', { conv: conv() }), /fermée/);
    await db.doc('conversations/' + conv()).update({ fermeeLe: avant, bloqueePar: null }); // remis pour la suite
  });
  test('conversation fermée après le retrait', async () => {
    assert.ok((await lire('conversations/' + conv())).fermeeLe, 'date de fermeture posée par la pesée');
    await db.doc('conversations/' + conv()).update({ fermeeLe: Timestamp.fromMillis(Date.now() - 1000) });
    await assert.rejects(appeler('client', 'envoyerMessage', { conv: conv(), texte: 'Encore là ?' }), /fermée/);
    await assert.rejects(appeler('client', 'jetonAppel', { conv: conv() }), /fermée/);
    await db.doc('conversations/' + conv()).update({ fermeeLe: null });
  });
});

describe('Besoins des professionnels', () => {
  test('un pêcheur accepte le besoin d’un pro : commande à régler', async () => {
    await compte('pro');
    await appeler('pro', 'choisirRole', { role: 'pro', prenom: 'Arlette', pro: { raison: 'Chez Tante Arlette', type: 'Restaurant', siret: '123 456 789 00015', commune: 'Le Robert' } });
    assert.equal((await lire('pros/' + comptes.pro.uid)).siretVerifie, true, 'SIRET confirmé par le répertoire des entreprises');
    assert.equal((await lire('pros/' + comptes.pro.uid)).siretNom, 'CHEZ TANTE ARLETTE');
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
    assert.equal(b.statut, 'en_attente_paiement'); assert.equal(b.origine, 'demande'); assert.equal(b.pro.siret, '12345678900015');
    assert.equal((await lire('demandes/' + d.id)).statut, 'acceptee');
    await assert.rejects(appeler('pecheur', 'accepterDemande', { id: d.id }), /déjà été pris/);
    assert.equal(await lire('conversations/' + etalId + '_' + comptes.pro.uid), undefined, 'messagerie ouverte seulement après paiement');
  });
  test('le pro obtient son lien de paiement', async () => {
    assert.ok((await appeler('pro', 'payerBon', { code: code2 })).url);
    await assert.rejects(appeler('client', 'payerBon', { code: code2 }), /introuvable/);
  });
  test('payée puis pesée : facture numérotée, contenu figé, PDF archivé, suivi complet', async () => {
    const b = await lire('bons/' + code2);
    const sid = (await lire('bonsSecrets/' + code2)).stripeSession;
    await webhook({ type: 'checkout.session.completed', data: { object: { id: sid, object: 'checkout.session', status: 'complete', amount_total: Math.round(b.montantBloque * 100), payment_intent: 'pi_2', metadata: { code: code2 } } } });
    assert.equal((await lire('bons/' + code2)).statut, 'reserve');
    const { codeRetrait } = await appeler('pro', 'monQr', { code: code2 });
    const r = await appeler('pecheur', 'validerPesee', { code: code2, poids: [14.6], preuve: codeRetrait });
    assert.equal(r.montantPaye, 190.7);
    const numero = (await lire('bons/' + code2)).facture;
    assert.match(numero, new RegExp('^FA-' + new Date().getFullYear() + '-000001$'), 'première facture de l’année');
    const f = await lire('factures/' + numero);
    assert.equal(f.totalTtc, 190.7); assert.equal(f.poisson.ttc, 189.8); assert.equal(f.services.ttc, 0.9);
    assert.equal(f.acheteur.siret, '12345678900015'); assert.equal(f.vendeur.immatriculation, 'MQ 123456');
    assert.equal(f.pdf, true, 'PDF archivé');
    const suivi = await db.collection('bons/' + code2 + '/historique').orderBy('n').get();
    assert.deepEqual(suivi.docs.map((d) => d.data().etape), ['commande_creee', 'payee', 'retiree', 'facture_emise']);
    assert.deepEqual(suivi.docs.map((d) => d.data().par), ['pecheur', 'stripe', 'pecheur', 'systeme']);
    assert.equal((await verifierSuivi(code2)).valide, true);
  });
  test('une étape modifiée après coup se voit (chaîne d’empreintes)', async () => {
    const ref = db.doc('bons/' + code2 + '/historique/0003');
    const avant = (await ref.get()).data();
    await ref.update({ details: { ...avant.details, debite: 1 } });
    assert.equal((await verifierSuivi(code2)).valide, false);
    await ref.set(avant);
    assert.equal((await verifierSuivi(code2)).valide, true);
    await db.doc('bons/' + code2 + '/historique/0002').delete();
    assert.equal((await verifierSuivi(code2)).valide, false, 'étape supprimée détectée');
  });
  test('une facture n’est jamais émise deux fois', async () => {
    const { emettreFacture } = require('../functions/lib/factures.js');
    assert.equal(await emettreFacture(code2), null);
    assert.equal((await db.collection('factures').get()).size, 1);
  });
});

describe('Formats de vente (kilo, pièce, barquettes, lot)', () => {
  const arrivage = (extra = []) => appeler('pecheur', 'publierArrivage', { lignes: [
    { espece: 'Thon jaune', format: 'kilo', prixKg: 14, dispoKg: 10, preparations: [{ nom: 'Entier', supplementKg: 0 }, { nom: 'En tranches', supplementKg: 2 }] },
    { espece: 'Dorade coryphène', format: 'piece', prixKg: 13, teteAuChoix: true, pieces: [{ poidsKg: 3.2 }, { poidsKg: 4 }], preparations: [{ nom: 'Entière', supplementKg: 0 }, { nom: 'Écaillé et vidé', supplementKg: 1 }] },
    { espece: 'Dorade coryphène', format: 'portion', prixKg: 19, portion: { type: 'Filets', poidsKg: 0.5, nombre: 6 } },
    { espece: 'Poisson volant', format: 'lot', lot: { quantite: 10, unite: 'pièces', prix: 10, nombre: 5 } }, ...extra] });
  let fc, dorade, filets, volants;
  test('un même arrivage mélange les formats ; même espèce en double refusée', async () => {
    const idThon = (await lire('etals/' + etalId)).produits[0].id;
    await assert.rejects(arrivage([{ espece: 'Dorade coryphène', format: 'piece', prixKg: 12, pieces: [{ poidsKg: 2 }] }]), /En double/);
    await assert.rejects(arrivage([{ espece: 'Colas', format: 'portion', prixKg: 12, portion: { type: 'Appelez 0696', poidsKg: 0.5, nombre: 2 } }]), /Barquettes invalides/);
    assert.equal((await arrivage()).produits, 4);
    const ps = (await lire('etals/' + etalId)).produits;
    assert.equal(ps[0].id, idThon, 'même identifiant pour le thon au kilo');
    [, dorade, filets, volants] = ps;
    assert.equal(dorade.format, 'piece'); assert.equal(dorade.pieces.length, 2); assert.equal(dorade.dispoKg, 7.2);
    assert.equal(filets.portion.nombre, 6); assert.equal(volants.lot.prix, 10);
  });
  test('le client choisit un poisson précis (sans tête), des barquettes et des lots', async () => {
    const quatre = dorade.pieces.find((x) => x.poidsKg === 4);
    const r = await appeler('client', 'creerReservation', { etalId, creneau: 'Avant 10 h', lignes: [
      { produitId: dorade.id, pieceId: quatre.id, tete: 'sans', preparation: 'Écaillé et vidé', kg: 99 },
      { produitId: filets.id, nombre: 2, kg: 99 },
      { produitId: volants.id, nombre: 2 }] });
    fc = r.code;
    const b = await lire('bons/' + fc);
    assert.equal(b.montantBloque, 103.4, '(56 + 19) × 1,1 + 20 € de lots + 0,90 €');
    assert.equal(b.lignes[0].kg, 4, 'poids du poisson choisi, pas celui envoyé'); assert.equal(b.lignes[0].tete, 'sans');
    assert.equal(b.lignes[1].kg, 1); assert.equal(b.lignes[2].prixLot, 10);
    const ps = (await lire('etals/' + etalId)).produits;
    assert.equal(ps[1].pieces.length, 1); assert.equal(ps[2].portion.nombre, 4); assert.equal(ps[3].lot.nombre, 3);
    await assert.rejects(appeler('autre', 'creerReservation', { etalId, creneau: 'Avant 10 h', lignes: [{ produitId: dorade.id, pieceId: quatre.id }] }), /vient d’être réservé/);
    await assert.rejects(appeler('autre', 'creerReservation', { etalId, creneau: 'Avant 10 h', lignes: [{ produitId: volants.id, nombre: 9 }] }), /Plus assez de poisson volant/);
  });
  test('pesée : poids réel pour le poisson et les barquettes, lots au prix fixe', async () => {
    const sid = (await lire('bonsSecrets/' + fc)).stripeSession;
    await webhook({ type: 'checkout.session.completed', data: { object: { id: sid, object: 'checkout.session', status: 'complete', amount_total: 10340, payment_intent: 'pi_formats', metadata: { code: fc } } } });
    assert.equal((await lire('bons/' + fc)).statut, 'reserve');
    const { codeRetrait } = await appeler('client', 'monQr', { code: fc });
    await assert.rejects(appeler('pecheur', 'validerPesee', { code: fc, poids: [4.1, 1.1, 3], preuve: codeRetrait }), /Plus de lots remis/);
    const r = await appeler('pecheur', 'validerPesee', { code: fc, poids: [4.1, 1.1, 2], preuve: codeRetrait });
    assert.equal(r.montantPaye, 99.2, '4,1 × 14 + 1,1 × 19 + 2 × 10 + 0,90');
  });
  test('avis réel après le retrait : un seul par bon, numéros masqués, note calculée par le serveur', async () => {
    await assert.rejects(appeler('client', 'laisserAvis', { code: fc, note: 6 }), /1 à 5/);
    await assert.rejects(appeler('autre', 'laisserAvis', { code: fc, note: 1 }), /Bon introuvable/);
    await appeler('client', 'laisserAvis', { code: fc, note: 4, commentaire: 'Très frais ! Appelez-moi au 0696 12 34 56' });
    await assert.rejects(appeler('client', 'laisserAvis', { code: fc, note: 5 }), /déjà donné/);
    const a = await lire('avis/' + fc);
    assert.equal(a.note, 4); assert.ok(!a.commentaire.includes('0696')); assert.equal(a.clientId, undefined, 'pas d’identifiant public');
    const e = await lire('etals/' + etalId);
    assert.equal(e.noteNombre, 1); assert.equal(e.note, 4); assert.equal(e.avis, 1);
    assert.equal((await lire('bons/' + fc)).avis, 4);
  });
  test('republier garde les poissons encore en vente (paniers en cours)', async () => {
    const reste = (await lire('etals/' + etalId)).produits[1].pieces[0];
    await appeler('pecheur', 'publierArrivage', { lignes: [
      { espece: 'Thon jaune', prixKg: 14, dispoKg: 10, preparations: [{ nom: 'Entier', supplementKg: 0 }, { nom: 'En tranches', supplementKg: 2 }] },
      { espece: 'Dorade coryphène', format: 'piece', prixKg: 13, pieces: [reste, { poidsKg: 5 }] }] });
    const ps = (await lire('etals/' + etalId)).produits;
    assert.equal(ps[1].pieces[0].id, reste.id); assert.notEqual(ps[1].pieces[1].id, reste.id);
  });
  test('réseau faible : le même arrivage renvoyé deux fois n’est appliqué qu’une fois', async () => {
    const lignes = [{ espece: 'Thon jaune', prixKg: 14, dispoKg: 10, preparations: [{ nom: 'Entier', supplementKg: 0 }, { nom: 'En tranches', supplementKg: 2 }] }];
    await appeler('pecheur', 'publierArrivage', { lignes, idEnvoi: 'envoi1abc' });
    const produit = (await lire('etals/' + etalId)).produits[0];
    await appeler('client', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 2, preparation: 'Entier' }], creneau: 'Avant 10 h' });
    const r = await appeler('pecheur', 'publierArrivage', { lignes, idEnvoi: 'envoi1abc' });
    assert.equal(r.doublon, true);
    assert.equal((await lire('etals/' + etalId)).produits[0].dispoKg, 8, 'la réservation faite entre-temps est conservée');
  });
});

describe('Réservations avant la sortie', () => {
  const dans = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const annonce = (thonMax = 5) => appeler('pecheur', 'annoncerSortie', { retour: dans(3), especes: [
    { espece: 'Thon jaune', prixKg: 14, kgMax: thonMax }, { espece: 'Dorade coryphène', prixKg: 13, kgMax: 4 }, { espece: 'Vivaneau', prixKg: 15, kgMax: 3 }] });
  let pThon;
  test('le pêcheur annonce sa sortie ; les clients réservent sans payer', async () => {
    await assert.rejects(appeler('pecheur', 'annoncerSortie', { retour: dans(100), especes: [{ espece: 'Thon jaune', prixKg: 14, kgMax: 5 }] }), /48 heures/);
    await assert.rejects(appeler('client', 'annoncerSortie', { retour: dans(3), especes: [{ espece: 'Thon jaune', prixKg: 14, kgMax: 5 }] }), /pêcheurs vérifiés/);
    await annonce();
    assert.equal((await lire('sorties/' + etalId)).statut, 'annoncee');
    pThon = (await appeler('client', 'precommander', { etalId, espece: 'Thon jaune', kg: 3 })).id;
    await appeler('client', 'precommander', { etalId, espece: 'Dorade coryphène', kg: 2 });
    await assert.rejects(appeler('autre', 'precommander', { etalId, espece: 'Thon jaune', kg: 3 }), /Plus que 2 kg/);
    await appeler('autre', 'precommander', { etalId, espece: 'Thon jaune', kg: 2 });
    await appeler('autre', 'precommander', { etalId, espece: 'Vivaneau', kg: 2 });
    await assert.rejects(appeler('client', 'precommander', { etalId, espece: 'Thon jaune', kg: 1 }), /déjà réservé/);
    await assert.rejects(appeler('client', 'precommander', { etalId, espece: 'Langouste', kg: 1 }), /non annoncée/);
    await assert.rejects(annonce(4), /déjà réservés/);
    assert.equal((await lire('sorties/' + etalId)).reserveKg['Thon jaune'], 5);
  });
  test('au retour, l’arrivage transforme les réservations en bons à payer, dans l’ordre', async () => {
    const r = await appeler('pecheur', 'publierArrivage', { lignes: [
      { espece: 'Thon jaune', prixKg: 14, dispoKg: 10, preparations: [{ nom: 'Entier', supplementKg: 0 }, { nom: 'En tranches', supplementKg: 2 }] },
      { espece: 'Dorade coryphène', format: 'piece', prixKg: 13, pieces: [{ poidsKg: 4 }] },
      { espece: 'Vivaneau', prixKg: 15, dispoKg: 1, preparations: [{ nom: 'Entier', supplementKg: 0 }] }] });
    assert.equal(r.converties, 3); assert.equal(r.nonServies, 1);
    const p = await lire('precommandes/' + pThon);
    assert.equal(p.statut, 'convertie');
    const b = await lire('bons/' + p.bonCode);
    assert.equal(b.origine, 'sortie'); assert.equal(b.statut, 'en_attente_paiement'); assert.equal(b.clientId, comptes.client.uid); assert.equal(b.lignes[0].kg, 3);
    assert.equal(b.montantBloque, 47.1, '3 × 14 × 1,1 + 0,90');
    const autres = (await db.collection('precommandes').where('etalId', '==', etalId).get()).docs.map((d) => d.data());
    assert.equal(autres.find((x) => x.espece === 'Vivaneau').kgServi, 1, 'servi en partie : 1 kg sur 2');
    assert.match(autres.find((x) => x.espece === 'Dorade coryphène').raison, /vendu autrement/);
    const etal = await lire('etals/' + etalId);
    assert.equal(etal.produits[0].dispoKg, 5); assert.equal(etal.produits[2].dispoKg, 0);
    assert.equal((await lire('sorties/' + etalId)).statut, 'rentree');
    await assert.rejects(appeler('client', 'precommander', { etalId, espece: 'Thon jaune', kg: 1 }), /plus ouverte/);
    // le client paie son bon dans l'heure, comme une commande acceptée
    const { url } = await appeler('client', 'payerBon', { code: p.bonCode });
    assert.ok(url);
  });
  test('sortie annulée : les réservations sont libérées', async () => {
    await annonce();
    const { id } = await appeler('autre', 'precommander', { etalId, espece: 'Thon jaune', kg: 1 });
    await appeler('pecheur', 'annulerSortie', { motif: 'mauvais temps' });
    assert.equal((await lire('precommandes/' + id)).statut, 'non_servie');
    assert.equal((await lire('sorties/' + etalId)).statut, 'annulee');
  });
});

describe('Règles d’annulation (réglages provisoires)', () => {
  const minutesMq = () => ((((Math.floor(Date.now() / 60_000) - 240) % 1440) + 1440) % 1440);
  const limite = (decalage) => db.doc('etals/' + etalId).update({ limiteRetrait: minutesMq() + decalage });
  const stock = async () => (await lire('etals/' + etalId)).produits[0].dispoKg;
  let n = 0;
  const bonPaye = async () => {
    const produit = (await lire('etals/' + etalId)).produits[0];
    const { code: c } = await appeler('client', 'creerReservation', { etalId, lignes: [{ produitId: produit.id, kg: 1, preparation: 'Entier' }], creneau: 'Avant 10 h' });
    const b = await lire('bons/' + c); const sid = (await lire('bonsSecrets/' + c)).stripeSession;
    await webhook({ type: 'checkout.session.completed', data: { object: { id: sid, object: 'checkout.session', status: 'complete', amount_total: Math.round(b.montantBloque * 100), payment_intent: 'pi_annul' + (n++), metadata: { code: c } } } });
    assert.equal((await lire('bons/' + c)).statut, 'reserve');
    return c;
  };
  test('le client annule à temps : rien débité, poisson remis en vente ; trop tard : refusé', async () => {
    await limite(180);
    const avant = await stock();
    const c = await bonPaye();
    await appeler('client', 'annulerParClient', { code: c });
    assert.equal((await lire('bons/' + c)).statut, 'annule');
    assert.equal(await stock(), avant);
    await limite(30);
    const c2 = await bonPaye();
    await assert.rejects(appeler('client', 'annulerParClient', { code: c2 }), /Trop tard/);
    await assert.rejects(appeler('autre', 'annulerParClient', { code: c2 }), /introuvable/);
    // rupture du pêcheur : rien débité, poisson PAS remis en vente
    const s2 = await stock();
    await appeler('pecheur', 'annulerParPecheur', { code: c2 });
    const b = await lire('bons/' + c2);
    assert.equal(b.statut, 'annule'); assert.equal(b.montantPaye, 0);
    assert.equal(await stock(), s2);
    assert.equal((await lire('etals/' + etalId)).ruptures.length, 1);
  });
  test('client absent : déclarable après l’heure limite + 60 min, 30 % du poisson débité', async () => {
    await limite(30);
    const c = await bonPaye();
    await assert.rejects(appeler('pecheur', 'clientAbsent', { code: c }), /Attendez 60 min/);
    await limite(-120);
    const avant = await stock();
    const r = await appeler('pecheur', 'clientAbsent', { code: c });
    assert.equal(r.debite, 4.2, '30 % de 1 kg × 14 €');
    const b = await lire('bons/' + c);
    assert.equal(b.statut, 'annule'); assert.equal(b.montantPaye, 4.2);
    assert.equal(await stock(), Math.round((avant + 1) * 10) / 10, 'poisson remis en vente');
    await db.doc('etals/' + etalId).update({ limiteRetrait: 720 });
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
  test('SIRET : chiffres faux ou établissement fermé refusés, inconnu mis en attente', async () => {
    await compte('pro2');
    const pro = (siret) => ({ role: 'pro', prenom: 'Lucie', pro: { raison: 'Le Comptoir', type: 'Restaurant', siret, commune: 'Le Robert' } });
    await assert.rejects(appeler('pro2', 'choisirRole', pro('12345678900012')), /n’existe pas/);
    await assert.rejects(appeler('pro2', 'choisirRole', pro('98765432100015')), /fermé/);
    await appeler('pro2', 'choisirRole', pro('55500011100024'));
    const p = await lire('pros/' + comptes.pro2.uid);
    assert.equal(p.siretVerifie, false); assert.equal(p.siretStatut, 'introuvable');
    await compte('pro2');
    await assert.rejects(appeler('pro2', 'posterDemande', { espece: 'Thon jaune', kg: 5, prixMaxKg: 13, pour: 'Demain' }), /en cours de vérification/);
  });
  test('un pêcheur vérifié qui change d’immatriculation repasse en vérification', async () => {
    await appeler('pecheur', 'choisirRole', { role: 'pecheur', prenom: 'Jean-Marc', pecheur: { port: 'Le Robert', bateau: 'Ti Moun', immatriculation: 'MQ 999999', numeroMarin: 'AB123456' } });
    assert.equal((await lire('etals/' + etalId)).statut, 'en_attente');
    await db.doc('etals/' + etalId).update({ statut: 'verifie' }); // remis pour la suite
  });
});

describe('Espace équipe', () => {
  test('réservé aux adresses listées dans reglages/equipe, e-mail confirmé', async () => {
    await compte('equipe');
    await assert.rejects(appeler('equipe', 'equipeTableau', {}), /Réservé à l’équipe/);
    await db.doc('reglages/equipe').set({ emails: ['Equipe@test.peche-connect.fr'] });
    assert.equal((await appeler('equipe', 'equipeAcces', {})).equipe, true);
    assert.equal((await appeler('client', 'equipeAcces', {})).equipe, false);
    await assert.rejects(appeler('pecheur', 'equipeDossier', { etalId, decision: 'verifier' }), /Réservé à l’équipe/);
  });
  test('dossier pêcheur : refus motivé, correction, puis vérification', async () => {
    await db.doc('etals/' + etalId).update({ statut: 'en_attente' });
    const t = await appeler('equipe', 'equipeTableau', {});
    const d = t.dossiers.find((x) => x.etalId === etalId);
    assert.equal(d.numeroMarin, 'AB123456'); assert.equal(d.immatriculation, 'MQ 999999');
    await assert.rejects(appeler('equipe', 'equipeDossier', { etalId, decision: 'refuser' }), /motif/);
    await appeler('equipe', 'equipeDossier', { etalId, decision: 'refuser', motif: 'Numéro de marin introuvable' });
    let e = await lire('etals/' + etalId);
    assert.equal(e.statut, 'refuse'); assert.equal(e.motifStatut, 'Numéro de marin introuvable');
    await appeler('pecheur', 'choisirRole', { role: 'pecheur', prenom: 'Jean-Marc', pecheur: { port: 'Le Robert', bateau: 'Ti Moun', immatriculation: 'MQ 999999', numeroMarin: 'AB123457' } });
    assert.equal((await lire('etals/' + etalId)).statut, 'en_attente', 'dossier corrigé : à revoir');
    await appeler('equipe', 'equipeDossier', { etalId, decision: 'verifier' });
    e = await lire('etals/' + etalId);
    assert.equal(e.statut, 'verifie'); assert.equal(e.motifStatut, null);
    const dossier = await lire('etals/' + etalId + '/verification/dossier');
    assert.equal(dossier.numeroVerifie, true); assert.equal(dossier.verifiePar, 'equipe@test.peche-connect.fr');
  });
  test('signalements : classer, ou suspendre le compte signalé', async () => {
    const t = await appeler('equipe', 'equipeTableau', {});
    assert.ok(t.signalements.length >= 1);
    const s = t.signalements[0];
    assert.equal(s.contre.role, 'pêcheur');
    await appeler('equipe', 'equipeSignalement', { id: s.id, decision: 'classer' });
    await assert.rejects(appeler('equipe', 'equipeSignalement', { id: s.id, decision: 'classer' }), /Déjà traité/);
    assert.equal((await lire('etals/' + etalId)).statut, 'verifie', 'classé : rien ne change');
    const r = await db.collection('signalements').add({ conv: 'x_y', par: comptes.client.uid, contre: comptes.robot.uid, motif: 'Insultes', bloquer: true, le: Timestamp.now(), traite: false });
    await appeler('equipe', 'equipeSignalement', { id: r.id, decision: 'suspendre' });
    assert.equal((await getAuth().getUser(comptes.robot.uid)).disabled, true, 'client bloqué');
  });
  test('avis abusif retiré : note de l’étal recalculée', async () => {
    const t = await appeler('equipe', 'equipeTableau', {});
    const a = t.avis.find((x) => x.etalId === etalId);
    await appeler('equipe', 'equipeRetirerAvis', { code: a.code });
    const e = await lire('etals/' + etalId);
    assert.equal(e.avis, 0); assert.equal(e.noteNombre, 0);
    assert.equal(await lire('avis/' + a.code), undefined);
  });
  test('facture archivée téléchargeable par l’équipe', async () => {
    const t = await appeler('equipe', 'equipeTableau', {});
    assert.ok(t.factures.length >= 1);
    const f = await appeler('equipe', 'equipeFacture', { numero: t.factures[0].numero });
    assert.equal(Buffer.from(f.pdf, 'base64').subarray(0, 4).toString(), '%PDF');
  });
});

describe('Mon compte (RGPD)', () => {
  test('télécharger mes données', async () => {
    const d = await appeler('client', 'compte', { action: 'exporter' });
    assert.equal(d.profil.prenom, 'Sophie'); assert.equal(d.bons.length, 7); assert.ok(d.conversations[0].messages.length >= 2); // thon au kilo, « formats », bon de sortie, 3 bons « annulation »
    assert.equal(d.reservations_avant_sortie.length, 2);
  });
  test('supprimer mon compte : bons gardés mais anonymisés, messages effacés', async () => {
    await appeler('client', 'compte', { action: 'supprimer' });
    const b = await lire('bons/' + code);
    assert.equal(b.clientId, null); assert.equal(b.clientPrenom, 'Compte supprimé');
    assert.equal(await lire('profils/' + comptes.client.uid), undefined);
    assert.equal(await lire('conversations/' + etalId + '_' + comptes.client.uid), undefined);
  });
});
