// Tests des règles d'accès Firestore et Storage (émulateurs Firebase).
// Lancement : firebase emulators:exec --only firestore,storage "npm --prefix tests run regles"
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, addDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

const ETAL = 'etalJM', ETAL2 = 'etalNouveau', CONV = 'etalJM_clientB';
let env;
const qui = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const quiS = (uid, claims = {}) => env.authenticatedContext(uid, claims).storage();
const visiteur = () => env.unauthenticatedContext().firestore();
const PECHEUR = ['pecheurA', { role: 'pecheur', etalId: ETAL, verifie: true }];
const CLIENT_B = ['clientB', { role: 'client' }];
const CLIENT_C = ['clientC', { role: 'client' }];
const PRO = ['proD', { role: 'pro' }];
const NOUVEAU = ['pecheurN', { role: 'pecheur', etalId: ETAL2, verifie: false }];
const msg = (x) => ({ auteurId: 'clientB', auteur: 'client', creeLe: serverTimestamp(), ...x });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-peche-connect',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'profils/clientB'), { role: 'client', prenom: 'Sophie', suivis: [], jetons: [] });
    await setDoc(doc(db, 'profils/clientC'), { role: 'client', prenom: 'Marc', suivis: [], jetons: [] });
    await setDoc(doc(db, 'pros/proD'), { raison: 'Chez Tante Arlette', type: 'Restaurant', siret: '12345678900012', commune: 'Le Robert', adresse: '12 rue du Port' });
    await setDoc(doc(db, 'etals', ETAL), { pecheurId: 'pecheurA', prenom: 'Jean-Marc', port: 'Le Robert', statut: 'verifie', stripePret: true, produits: [{ id: 'p1', espece: 'Thon jaune', prixKg: 14, dispoKg: 10 }] });
    await setDoc(doc(db, 'etals', ETAL, 'prive', 'infos'), { lieu: 'Débarcadère du Robert', precision: 'à gauche de la cale', immatriculation: 'MQ 123456' });
    await setDoc(doc(db, 'etals', ETAL2), { pecheurId: 'pecheurN', prenom: 'Nouveau', port: 'Trinité', statut: 'en_attente', stripePret: false, produits: [] });
    await setDoc(doc(db, 'etals', ETAL2, 'prive', 'infos'), { lieu: 'Trinité', precision: '', immatriculation: 'FF 999999' });
    await setDoc(doc(db, 'comptesStripe', ETAL), { compte: 'acct_secret' });
    await setDoc(doc(db, 'acces', ETAL + '_clientB'), { jusqua: Timestamp.fromMillis(Date.now() + 3600_000) });
    await setDoc(doc(db, 'acces', ETAL + '_clientC'), { jusqua: Timestamp.fromMillis(Date.now() - 3600_000) }); // expiré
    await setDoc(doc(db, 'bons/R-100'), { code: 'R-100', etalId: ETAL, pecheurId: 'pecheurA', clientId: 'clientB', clientPrenom: 'Sophie', statut: 'reserve', montantBloque: 27.3 });
    await setDoc(doc(db, 'bonsSecrets/R-100'), { signature: 'sig', stripePaiement: 'pi_1' });
    await setDoc(doc(db, 'conversations', CONV), { etalId: ETAL, pecheurId: 'pecheurA', clientId: 'clientB', clientPrenom: 'Sophie', bonCode: 'R-100', participants: ['clientB', 'pecheurA'], luClient: false, luPecheur: false });
    await setDoc(doc(db, 'conversations', CONV, 'messages', 'm1'), { auteur: 'systeme', texte: 'Réservation payée' });
    await setDoc(doc(db, 'demandes/d1'), { proId: 'proD', proRaison: 'Chez Tante Arlette', proType: 'Restaurant', proCommune: 'Le Robert', espece: 'Thon jaune', kg: 15, prixMaxKg: 13, pour: 'Demain', statut: 'ouverte' });
    await setDoc(doc(db, 'reglages/general'), { fraisService: 0.9 });
    await setDoc(doc(db, 'reglages/equipe'), { emails: ['equipe@peche-connect.fr'] });
    await setDoc(doc(db, 'avis/R-100'), { etalId: ETAL, prenom: 'Sophie', note: 5, commentaire: 'Très frais' });
    await setDoc(doc(db, 'bons/R-100/historique/0001'), { n: 1, etape: 'reservee', par: 'client', uid: 'clientB' });
    await setDoc(doc(db, 'factures/FA-2026-000001'), { numero: 'FA-2026-000001', proId: 'proD', pecheurId: 'pecheurA', totalTtc: 190.7 });
  });
});
after(async () => { await env?.cleanup(); });

describe('Visiteur non connecté', () => {
  test('voit la vitrine des étals vérifiés', () => assertSucceeds(getDocs(query(collection(visiteur(), 'etals'), where('statut', '==', 'verifie'), where('stripePret', '==', true)))));
  test('ne voit pas un étal non vérifié', () => assertFails(getDoc(doc(visiteur(), 'etals', ETAL2))));
  test('ne peut pas lister tous les étals sans filtre', () => assertFails(getDocs(collection(visiteur(), 'etals'))));
  test('adresse exacte inaccessible', () => assertFails(getDoc(doc(visiteur(), 'etals', ETAL, 'prive', 'infos'))));
  test('dossier de vérification du pêcheur inaccessible', () => assertFails(getDoc(doc(visiteur(), 'etals', ETAL, 'verification', 'dossier'))));
  test('bons inaccessibles', () => assertFails(getDoc(doc(visiteur(), 'bons/R-100'))));
  test('profils inaccessibles', () => assertFails(getDoc(doc(visiteur(), 'profils/clientB'))));
  test('lit les réglages', () => assertSucceeds(getDoc(doc(visiteur(), 'reglages/general'))));
  test('la liste de l’équipe reste privée', () => assertFails(getDoc(doc(visiteur(), 'reglages/equipe'))));
  test('lit les avis d’un étal', () => assertSucceeds(getDocs(query(collection(visiteur(), 'avis'), where('etalId', '==', ETAL)))));
});

describe('Client sans bon', () => {
  test('adresse exacte cachée (accès expiré)', () => assertFails(getDoc(doc(qui(...CLIENT_C), 'etals', ETAL, 'prive', 'infos'))));
  test('ne lit pas le bon d’un autre', () => assertFails(getDoc(doc(qui(...CLIENT_C), 'bons/R-100'))));
  test('ne lit pas la conversation d’un autre', () => assertFails(getDoc(doc(qui(...CLIENT_C), 'conversations', CONV))));
  test('ne lit pas les messages d’un autre', () => assertFails(getDocs(collection(qui(...CLIENT_C), 'conversations', CONV, 'messages'))));
  test('ne lit pas le SIRET des pros', () => assertFails(getDoc(doc(qui(...CLIENT_C), 'pros/proD'))));
  test('ne lit pas le profil d’un autre', () => assertFails(getDoc(doc(qui(...CLIENT_C), 'profils/clientB'))));
  test('lit son propre profil', () => assertSucceeds(getDoc(doc(qui(...CLIENT_C), 'profils/clientC'))));
  test('change son prénom et ses alertes', () => assertSucceeds(updateDoc(doc(qui(...CLIENT_C), 'profils/clientC'), { prenom: 'Marco', suivis: ['Thazard'] })));
  test('suit un pêcheur favori', () => assertSucceeds(updateDoc(doc(qui(...CLIENT_C), 'profils/clientC'), { favoris: [ETAL] })));
  test('pas plus de 50 pêcheurs favoris', () => assertFails(updateDoc(doc(qui(...CLIENT_C), 'profils/clientC'), { favoris: Array.from({ length: 51 }, (_, i) => 'e' + i) })));
  test('ne peut pas changer son rôle', () => assertFails(updateDoc(doc(qui(...CLIENT_C), 'profils/clientC'), { role: 'pecheur' })));
  test('pas de numéro caché dans le prénom', () => assertFails(updateDoc(doc(qui(...CLIENT_C), 'profils/clientC'), { prenom: 'Marc 0696123456' })));
  test('pas de numéro caché dans la commune', () => assertFails(updateDoc(doc(qui(...CLIENT_C), 'profils/clientC'), { commune: 'Appelez 0696' })));
  test('ne touche pas à ses jetons de notification directement', () => assertFails(updateDoc(doc(qui(...CLIENT_C), 'profils/clientC'), { jetons: ['x'] })));
  test('ne peut pas se donner un rôle', () => assertFails(updateDoc(doc(qui(...CLIENT_C), 'profils/clientC'), { role: 'pecheur' })));
  test('ne peut pas créer de bon sans payer', () => assertFails(setDoc(doc(qui(...CLIENT_C), 'bons/R-999'), { clientId: 'clientC', statut: 'reserve' })));
  test('ne peut pas changer les prix d’un pêcheur', () => assertFails(updateDoc(doc(qui(...CLIENT_C), 'etals', ETAL), { produits: [] })));
  test('ne peut pas se donner l’accès à l’adresse', () => assertFails(setDoc(doc(qui(...CLIENT_C), 'acces', ETAL + '_clientC'), { jusqua: Timestamp.fromMillis(Date.now() + 9e9) })));
  test('ne voit pas les besoins des pros', () => assertFails(getDoc(doc(qui(...CLIENT_C), 'demandes/d1'))));
  test('ne peut pas publier un besoin de pro', () => assertFails(addDoc(collection(qui(...CLIENT_C), 'demandes'), { proId: 'clientC', proRaison: 'x', proType: 'Restaurant', proCommune: 'x', espece: 'Thon', kg: 5, prixMaxKg: 10, pour: 'Demain', statut: 'ouverte', creeLe: serverTimestamp() })));
});

describe('Client avec un bon payé', () => {
  test('ne peut pas écrire un avis lui-même (seul le serveur, après le retrait)', () => assertFails(setDoc(doc(qui(...CLIENT_B), 'avis/R-100'), { etalId: ETAL, prenom: 'Sophie', note: 5, commentaire: '' })));
  test('adresse exacte débloquée', () => assertSucceeds(getDoc(doc(qui(...CLIENT_B), 'etals', ETAL, 'prive', 'infos'))));
  test('mais pas celle d’un autre pêcheur', () => assertFails(getDoc(doc(qui(...CLIENT_B), 'etals', ETAL2, 'prive', 'infos'))));
  test('voit son bon', () => assertSucceeds(getDoc(doc(qui(...CLIENT_B), 'bons/R-100'))));
  test('liste ses bons', () => assertSucceeds(getDocs(query(collection(qui(...CLIENT_B), 'bons'), where('clientId', '==', 'clientB')))));
  test('signature du QR et références Stripe illisibles', () => assertFails(getDoc(doc(qui(...CLIENT_B), 'bonsSecrets/R-100'))));
  test('compte Stripe du pêcheur illisible', () => assertFails(getDoc(doc(qui(...CLIENT_B), 'comptesStripe', ETAL))));
  test('ne peut pas modifier son bon', () => assertFails(updateDoc(doc(qui(...CLIENT_B), 'bons/R-100'), { statut: 'retire' })));
  test('lit la conversation', () => assertSucceeds(getDocs(collection(qui(...CLIENT_B), 'conversations', CONV, 'messages'))));
  test('écriture directe d’un message refusée (tout passe par le serveur, qui masque les numéros)', () => assertFails(addDoc(collection(qui(...CLIENT_B), 'conversations', CONV, 'messages'), msg({ texte: 'Bonjour' }))));
  test('message vocal direct refusé aussi', () => assertFails(addDoc(collection(qui(...CLIENT_B), 'conversations', CONV, 'messages'), msg({ audio: { chemin: CONV + '/1.m4a', duree: 7 } }))));
  test('ne peut pas écrire au nom du pêcheur', () => assertFails(addDoc(collection(qui(...CLIENT_B), 'conversations', CONV, 'messages'), msg({ auteur: 'pecheur', texte: 'faux' }))));
  test('ne peut pas envoyer de position', () => assertFails(addDoc(collection(qui(...CLIENT_B), 'conversations', CONV, 'messages'), msg({ position: { libelle: 'x', lat: 1, lon: 1 }, positionExpireLe: Timestamp.fromMillis(Date.now() + 1000) }))));
  test('marque la conversation lue', () => assertSucceeds(updateDoc(doc(qui(...CLIENT_B), 'conversations', CONV), { luClient: true })));
  test('ne peut pas rediriger la conversation vers un autre pêcheur', () => assertFails(updateDoc(doc(qui(...CLIENT_B), 'conversations', CONV), { pecheurId: 'pecheurN', participants: ['clientB', 'pecheurN'] })));
  test('ne peut pas marquer lu à la place du pêcheur', () => assertFails(updateDoc(doc(qui(...CLIENT_B), 'conversations', CONV), { luPecheur: true })));
});

describe('Pêcheur', () => {
  test('voit les bons de son étal', () => assertSucceeds(getDocs(query(collection(qui(...PECHEUR), 'bons'), where('pecheurId', '==', 'pecheurA')))));
  test('ne voit pas le SIRET des pros', () => assertFails(getDoc(doc(qui(...PECHEUR), 'pros/proD'))));
  test('ne voit pas le profil des clients', () => assertFails(getDoc(doc(qui(...PECHEUR), 'profils/clientB'))));
  test('voit et modifie son adresse', () => assertSucceeds(updateDoc(doc(qui(...PECHEUR), 'etals', ETAL, 'prive', 'infos'), { lieu: 'Ponton du Robert', precision: 'bateau bleu' })));
  test('ne modifie pas son immatriculation lui-même', () => assertFails(updateDoc(doc(qui(...PECHEUR), 'etals', ETAL, 'prive', 'infos'), { immatriculation: 'XX' })));
  test('ne modifie pas son étal directement (prix, statut)', () => assertFails(updateDoc(doc(qui(...PECHEUR), 'etals', ETAL), { statut: 'verifie' })));
  test('position directe refusée (passe par le serveur)', () => assertFails(addDoc(collection(qui(...PECHEUR), 'conversations', CONV, 'messages'), { auteurId: 'pecheurA', auteur: 'pecheur', position: { libelle: 'En direct', lat: 14.67, lon: -60.94 }, positionExpireLe: Timestamp.fromMillis(Date.now() + 3600_000), creeLe: serverTimestamp() })));
  test('voit les besoins ouverts des pros', () => assertSucceeds(getDoc(doc(qui(...PECHEUR), 'demandes/d1'))));
  test('un pêcheur non vérifié ne les voit pas', () => assertFails(getDoc(doc(qui(...NOUVEAU), 'demandes/d1'))));
  test('un pêcheur non vérifié voit quand même son étal', () => assertSucceeds(getDoc(doc(qui(...NOUVEAU), 'etals', ETAL2))));
  test('mais pas l’étal privé d’un autre', () => assertFails(getDoc(doc(qui(...NOUVEAU), 'etals', ETAL, 'prive', 'infos'))));
});

describe('Professionnel', () => {
  test('voit ses propres infos', () => assertSucceeds(getDoc(doc(qui(...PRO), 'pros/proD'))));
  test('publication directe d’un besoin refusée (passe par le serveur)', () => assertFails(addDoc(collection(qui(...PRO), 'demandes'), { proId: 'proD', proRaison: 'Chez Tante Arlette', proType: 'Restaurant', proCommune: 'Le Robert', espece: 'Vivaneau', kg: 10, prixMaxKg: 16, pour: 'Aujourd’hui', statut: 'ouverte', creeLe: serverTimestamp() })));
  test('ne publie pas au nom d’un autre', () => assertFails(addDoc(collection(qui(...PRO), 'demandes'), { proId: 'autre', proRaison: 'x', proType: 'Restaurant', proCommune: 'x', espece: 'Vivaneau', kg: 10, prixMaxKg: 16, pour: 'Demain', statut: 'ouverte', creeLe: serverTimestamp() })));
  test('ne peut pas marquer son besoin « accepté »', () => assertFails(updateDoc(doc(qui(...PRO), 'demandes/d1'), { statut: 'acceptee' })));
  test('annule son besoin', () => assertSucceeds(updateDoc(doc(qui(...PRO), 'demandes/d1'), { statut: 'annulee' })));
});

describe('Suivi des commandes et factures', () => {
  test('le client lit le suivi de son bon', () => assertSucceeds(getDocs(collection(qui(...CLIENT_B), 'bons/R-100/historique'))));
  test('le pêcheur aussi', () => assertSucceeds(getDoc(doc(qui(...PECHEUR), 'bons/R-100/historique/0001'))));
  test('un autre client ne le lit pas', () => assertFails(getDoc(doc(qui(...CLIENT_C), 'bons/R-100/historique/0001'))));
  test('le numéro de marin n’est lisible par aucun client', () => assertFails(getDoc(doc(qui(...CLIENT_B), 'etals', ETAL, 'verification', 'dossier'))));
  test('les signalements ne sont lisibles par personne depuis l’appli', () => assertFails(getDocs(collection(qui(...CLIENT_B), 'signalements'))));
  test('personne ne réécrit l’historique', () => assertFails(updateDoc(doc(qui(...CLIENT_B), 'bons/R-100/historique/0001'), { etape: 'annulee' })));
  test('personne n’ajoute d’étape', () => assertFails(setDoc(doc(qui(...PECHEUR), 'bons/R-100/historique/0002'), { n: 2, etape: 'retiree' })));
  test('le pro lit sa facture', () => assertSucceeds(getDoc(doc(qui(...PRO), 'factures/FA-2026-000001'))));
  test('le pêcheur vendeur aussi', () => assertSucceeds(getDoc(doc(qui(...PECHEUR), 'factures/FA-2026-000001'))));
  test('un client ne lit pas la facture d’un autre', () => assertFails(getDoc(doc(qui(...CLIENT_B), 'factures/FA-2026-000001'))));
  test('une facture ne se modifie pas', () => assertFails(updateDoc(doc(qui(...PRO), 'factures/FA-2026-000001'), { totalTtc: 1 })));
  test('une facture ne se crée pas depuis l’appli', () => assertFails(setDoc(doc(qui(...PRO), 'factures/FA-2026-000002'), { proId: 'proD', pecheurId: 'pecheurA' })));
  test('PDF de facture : lu par le pro, pas par un autre, jamais écrit depuis l’appli', async () => {
    await env.withSecurityRulesDisabled((c) => uploadBytes(ref(c.storage(), 'factures/FA-2026-000001.pdf'), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf', customMetadata: { proId: 'proD', pecheurId: 'pecheurA' } }));
    await assertSucceeds(getBytes(ref(quiS(...PRO), 'factures/FA-2026-000001.pdf')));
    await assertFails(getBytes(ref(quiS(...CLIENT_B), 'factures/FA-2026-000001.pdf')));
    await assertFails(uploadBytes(ref(quiS(...PRO), 'factures/FA-2026-000001.pdf'), new Uint8Array([1]), { contentType: 'application/pdf', customMetadata: { proId: 'proD', pecheurId: 'pecheurA' } }));
  });
});

describe('Fichiers', () => {
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const son = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
  test('le pêcheur dépose la photo de sa pêche', () => assertSucceeds(uploadBytes(ref(quiS(...PECHEUR), 'arrivages/' + ETAL + '/1.jpg'), image, { contentType: 'image/jpeg' })));
  test('pas dans le dossier d’un autre étal', () => assertFails(uploadBytes(ref(quiS(...PECHEUR), 'arrivages/' + ETAL2 + '/1.jpg'), image, { contentType: 'image/jpeg' })));
  test('pas autre chose qu’une image', () => assertFails(uploadBytes(ref(quiS(...PECHEUR), 'arrivages/' + ETAL + '/x.html'), image, { contentType: 'text/html' })));
  test('photo originale illisible tant que le serveur ne l’a pas nettoyée (position GPS)', () => assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'arrivages/' + ETAL + '/1.jpg'))));
  test('le pêcheur ne peut pas déclarer sa photo « nettoyée »', () => assertFails(uploadBytes(ref(quiS(...PECHEUR), 'arrivages/' + ETAL + '/2.jpg'), image, { contentType: 'image/jpeg', customMetadata: { nettoye: '1' } })));
  test('photo nettoyée lisible par tous', async () => {
    await env.withSecurityRulesDisabled((c) => uploadBytes(ref(c.storage(), 'arrivages/' + ETAL + '/3.jpg'), image, { contentType: 'image/jpeg', customMetadata: { nettoye: '1' } }));
    await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(), 'arrivages/' + ETAL + '/3.jpg')));
  });
  test('le client dépose un message vocal dans sa conversation', () => assertSucceeds(uploadBytes(ref(quiS(...CLIENT_B), 'messages-audio/' + CONV + '/1.m4a'), son, { contentType: 'audio/mp4' })));
  test('le pêcheur de la conversation l’écoute', () => assertSucceeds(getBytes(ref(quiS(...PECHEUR), 'messages-audio/' + CONV + '/1.m4a'))));
  test('un autre client ne peut pas l’écouter', () => assertFails(getBytes(ref(quiS(...CLIENT_C), 'messages-audio/' + CONV + '/1.m4a'))));
  test('un visiteur ne peut pas l’écouter', () => assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'messages-audio/' + CONV + '/1.m4a'))));
  test('impossible de déposer dans la conversation d’un autre', () => assertFails(uploadBytes(ref(quiS(...CLIENT_C), 'messages-audio/' + CONV + '/2.m4a'), son, { contentType: 'audio/mp4' })));
});

