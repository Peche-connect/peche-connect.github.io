// Liaison avec le serveur Firebase (connexion, base Firestore, fichiers, fonctions serveur Stripe).
// Utilisé seulement en mode réel, c'est-à-dire quand les clés EXPO_PUBLIC_FIREBASE_* sont renseignées
// (voir .env.example). Ces clés sont publiques par nature : la sécurité vient des règles d'accès
// (app/firebase/firestore.rules et storage.rules) et des fonctions serveur. Aucune clé secrète ici.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator, getAuth, GoogleAuthProvider, initializeAuth, isSignInWithEmailLink, OAuthProvider, onAuthStateChanged,
  sendSignInLinkToEmail, signInWithEmailLink, signInWithPopup, signInWithRedirect, signOut, type Auth, type User,
} from 'firebase/auth';
import {
  addDoc, arrayRemove, arrayUnion, collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, onSnapshot, orderBy,
  query, serverTimestamp, Timestamp, updateDoc, where, type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getBlob, getDownloadURL, getStorage, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { Platform } from 'react-native';
import type { Bon, Conversation, Demande, Etal, InfosPro, LignePanier, Message, Session } from '../types';

const CONFIG = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};
const EMULATEUR = process.env.EXPO_PUBLIC_FIREBASE_EMULATEUR ?? ''; // tests automatiques : « 127.0.0.1 »
const SITE = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://peche-connect.fr').replace(/\/$/, '');
export const CONNEXION_GOOGLE = process.env.EXPO_PUBLIC_CONNEXION_GOOGLE !== '0';
export const CONNEXION_APPLE = process.env.EXPO_PUBLIC_CONNEXION_APPLE === '1';
export const CONNEXION_EMAIL = process.env.EXPO_PUBLIC_CONNEXION_EMAIL !== '0';

let _auth: Auth, _db: Firestore, _fn: Functions, _st: FirebaseStorage;
function init() {
  if (_db) return;
  const app = getApps().length ? getApp() : initializeApp(CONFIG);
  if (Platform.OS === 'web') _auth = getAuth(app);
  else {
    // appli installée : la session est gardée dans le téléphone
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getReactNativePersistence } = require('firebase/auth') as { getReactNativePersistence: (s: unknown) => never };
    _auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  }
  _auth.languageCode = 'fr';
  _db = getFirestore(app);
  _fn = getFunctions(app, 'europe-west9');
  _st = getStorage(app);
  if (EMULATEUR) {
    connectAuthEmulator(_auth, 'http://' + EMULATEUR + ':9099', { disableWarnings: true });
    connectFirestoreEmulator(_db, EMULATEUR, 8080);
    connectFunctionsEmulator(_fn, EMULATEUR, 5001);
    connectStorageEmulator(_st, EMULATEUR, 9199);
  }
}
const auth = () => (init(), _auth);
const db = () => (init(), _db);

export class ErreurServeur extends Error {}
const MESSAGES: Record<string, string> = {
  'permission-denied': 'Action non autorisée.', unauthenticated: 'Session expirée, reconnectez-vous.', unavailable: 'Pas de connexion au serveur. Vérifiez votre réseau puis réessayez.',
  'auth/network-request-failed': 'Pas de connexion au serveur. Vérifiez votre réseau puis réessayez.', 'auth/invalid-action-code': 'Ce lien de connexion a expiré ou a déjà servi. Demandez-en un nouveau.',
  'auth/invalid-email': 'Adresse e-mail invalide.', 'auth/popup-closed-by-user': 'Connexion annulée.', 'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
};
function lisible(e: unknown): ErreurServeur {
  const x = e as { code?: string; message?: string };
  const code = String(x?.code ?? '').replace(/^functions\//, '');
  // les fonctions serveur renvoient déjà un message en français
  if (x?.code?.startsWith('functions/') && !['internal', 'unavailable', 'unauthenticated'].includes(code) && x.message) return new ErreurServeur(x.message);
  return new ErreurServeur(MESSAGES[code] ?? MESSAGES[x?.code ?? ''] ?? 'Erreur du serveur, réessayez dans un instant.');
}
async function fonction<T>(nom: string, data: Record<string, unknown>): Promise<T> {
  init();
  try { return (await httpsCallable<Record<string, unknown>, T>(_fn, nom)(data)).data; } catch (e) { throw lisible(e); }
}
async function essai<T>(f: () => Promise<T>): Promise<T> { try { return await f(); } catch (e) { throw e instanceof ErreurServeur ? e : lisible(e); } }

// ───────── Heures : la Martinique est à UTC−4 toute l'année ─────────
const versDate = (d: Date | string | Timestamp | null | undefined) => (!d ? null : d instanceof Timestamp ? d.toDate() : typeof d === 'string' ? new Date(d) : d);
export const minutesMartinique = (d: Date | string | Timestamp | null | undefined) => {
  const x = versDate(d); if (!x) return 0;
  return (((x.getUTCHours() - 4) * 60 + x.getUTCMinutes()) % 1440 + 1440) % 1440;
};
export const maintenantMartinique = () => minutesMartinique(new Date());

// ───────── Connexion : Google, Apple, ou lien reçu par e-mail (gratuits, sans SMS) ─────────
const CLE_EMAIL = 'peche-connect-email-connexion';
export async function connexionGoogle() {
  if (Platform.OS !== 'web') throw new ErreurServeur('Dans l’appli installée, la connexion Google arrive avec la version App Store / Google Play.');
  const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth(), p); } catch (e) {
    if ((e as { code?: string }).code === 'auth/popup-blocked') { await signInWithRedirect(auth(), p); return; }
    throw lisible(e);
  }
}
export async function connexionApple() {
  if (Platform.OS !== 'web') throw new ErreurServeur('Dans l’appli installée, la connexion Apple arrive avec la version App Store.');
  const p = new OAuthProvider('apple.com'); p.addScope('email'); p.addScope('name'); p.setCustomParameters({ locale: 'fr' });
  try { await signInWithPopup(auth(), p); } catch (e) { throw lisible(e); }
}
export async function envoyerLienEmail(email: string) {
  const adresse = email.trim().toLowerCase();
  await essai(() => sendSignInLinkToEmail(auth(), adresse, { url: (Platform.OS === 'web' ? window.location.origin : SITE) + '/connexion', handleCodeInApp: true }));
  await AsyncStorage.setItem(CLE_EMAIL, adresse);
}
// Au retour du lien reçu par e-mail : connexion automatique (demande l'adresse si autre appareil)
export const estLienEmail = (url: string) => (init(), isSignInWithEmailLink(_auth, url));
export async function terminerLienEmail(url: string, emailSaisi?: string) {
  const email = emailSaisi?.trim().toLowerCase() || (await AsyncStorage.getItem(CLE_EMAIL));
  if (!email) return false;
  await essai(() => signInWithEmailLink(auth(), email, url));
  await AsyncStorage.removeItem(CLE_EMAIL);
  return true;
}
export async function deconnexion() { await signOut(auth()); }
export function surChangementSession(f: (connecte: boolean) => void) {
  return { unsubscribe: onAuthStateChanged(auth(), (u) => f(!!u)) };
}

// ───────── Profil ─────────
async function utilisateur(): Promise<User | null> { await auth().authStateReady(); return _auth.currentUser; }
async function droits(rafraichir = false) {
  const u = await utilisateur(); if (!u) return null;
  return (await u.getIdTokenResult(rafraichir)).claims as { role?: string; etalId?: string; verifie?: boolean };
}

export async function chargerSession(): Promise<{ session: Session; profilIncomplet: boolean; uid: string | null }> {
  const u = await utilisateur();
  if (!u) return { session: null, profilIncomplet: false, uid: null };
  const p = (await essai(() => getDoc(doc(db(), 'profils', u.uid)))).data() as { role: string; prenom: string } | undefined;
  if (!p?.prenom) return { session: null, profilIncomplet: true, uid: u.uid };
  const base = { telephone: '', email: u.email ?? undefined, prenom: p.prenom };
  if (p.role === 'pecheur') {
    const c = await droits(true);
    const e = c?.etalId ? (await essai(() => getDoc(doc(db(), 'etals', c.etalId!)))).data() : undefined;
    return { uid: u.uid, profilIncomplet: false, session: { ...base, role: 'pecheur', etalId: c?.etalId, statutPecheur: e?.statut === 'verifie' ? 'verifie' : 'en_attente', stripePret: !!e?.stripePret } };
  }
  if (p.role === 'pro') {
    const pro = (await essai(() => getDoc(doc(db(), 'pros', u.uid)))).data() as (InfosPro & { adresse: string | null }) | undefined;
    if (!pro) return { session: null, profilIncomplet: true, uid: u.uid };
    return { uid: u.uid, profilIncomplet: false, session: { ...base, role: 'client', pro: { raison: pro.raison, type: pro.type, siret: pro.siret, commune: pro.commune, adresse: pro.adresse ?? undefined } } };
  }
  return { uid: u.uid, profilIncomplet: false, session: { ...base, role: 'client' } };
}

async function choisirRole(data: Record<string, unknown>) {
  await fonction('choisirRole', data);
  await droits(true); // relit les droits (rôle, étal) posés par le serveur
}
export const enregistrerClient = (prenom: string, commune?: string) => choisirRole({ role: 'client', prenom, commune: commune ?? null });
export const enregistrerPro = (prenom: string, pro: InfosPro) => choisirRole({ role: 'pro', prenom, pro: { ...pro, adresse: pro.adresse ?? '' } });
export const inscrirePecheur = (i: { prenom: string; port: string; bateau: string; immatriculation: string }) =>
  choisirRole({ role: 'pecheur', prenom: i.prenom, pecheur: { port: i.port, bateau: i.bateau, immatriculation: i.immatriculation } });

// ───────── Lecture des données ─────────
type DocEtal = { prenom: string; port: string; note: number; avis: number; bateau: string; photoUrl: string | null; debarqueLe: Timestamp | null; limiteRetrait: number; produits: Etal['produits']; pecheurId: string };
const versEtal = (id: string, e: DocEtal, prive?: { lieu?: string; precision?: string }): Etal => ({
  id, pecheur: e.prenom, port: e.port, note: Number(e.note ?? 5), avis: e.avis ?? 0, bateau: e.bateau ?? '', photo: e.photoUrl ?? undefined,
  debarque: e.debarqueLe ? minutesMartinique(e.debarqueLe) : -600, limiteRetrait: e.limiteRetrait ?? 720,
  lieu: prive?.lieu || undefined, precision: prive?.precision || undefined, produits: e.produits ?? [],
});

// Étals visibles ; adresse exacte seulement pour son propre étal et ceux où l'on a un bon payé
export async function chargerEtals(avecAdresse: string[] = []): Promise<Etal[]> {
  const q = await essai(() => getDocs(query(collection(db(), 'etals'), where('statut', '==', 'verifie'), where('stripePret', '==', true))));
  const etals = new Map(q.docs.map((d) => [d.id, d.data() as DocEtal]));
  const c = await droits();
  if (c?.etalId && !etals.has(c.etalId)) { const mien = await getDoc(doc(db(), 'etals', c.etalId)); if (mien.exists()) etals.set(mien.id, mien.data() as DocEtal); }
  const ids = [...new Set([...avecAdresse, ...(c?.etalId ? [c.etalId] : [])])];
  const prives = new Map<string, { lieu?: string; precision?: string }>();
  await Promise.all(ids.map(async (id) => { try { const p = await getDoc(doc(db(), 'etals', id, 'prive', 'infos')); if (p.exists()) prives.set(id, p.data()); } catch { /* pas d'accès */ } }));
  // étals où j'ai un bon mais qui ne sont plus en vitrine (le bon doit rester affichable)
  await Promise.all(avecAdresse.filter((id) => !etals.has(id)).map(async (id) => { try { const d = await getDoc(doc(db(), 'etals', id)); if (d.exists()) etals.set(id, d.data() as DocEtal); } catch { /* étal masqué */ } }));
  return [...etals].map(([id, e]) => versEtal(id, e, prives.get(id)));
}

type DocBon = { code: string; etalId: string; clientId: string | null; clientPrenom: string; pro: InfosPro | null; livraison: { adresse: string; frais: number } | null; lignes: (Omit<LignePanier, 'produitId'> & { produitId: string | null })[]; creneau: string; statut: string; montantBloque: number; montantPaye: number | null; creeLe: Timestamp | null };
export async function chargerBons(moi: string): Promise<Bon[]> {
  const c = await droits();
  const qs = [query(collection(db(), 'bons'), where('clientId', '==', moi))];
  if (c?.role === 'pecheur') qs.push(query(collection(db(), 'bons'), where('pecheurId', '==', moi)));
  const docs = (await Promise.all(qs.map((q) => essai(() => getDocs(q))))).flatMap((r) => r.docs.map((d) => d.data() as DocBon));
  const vus = new Set<string>();
  return docs.filter((b) => b.statut !== 'annule' && !vus.has(b.code) && !!vus.add(b.code))
    .sort((a, b) => (a.creeLe?.toMillis() ?? 0) - (b.creeLe?.toMillis() ?? 0))
    .map((b) => ({
      code: b.code, etalId: b.etalId, client: b.clientId === moi ? 'Vous' : b.clientPrenom, pro: b.pro ?? undefined, livraison: b.livraison ?? undefined,
      lignes: b.lignes.map((l) => ({ ...l, produitId: l.produitId ?? 'commande' })), creneau: b.creneau, montantBloque: Number(b.montantBloque),
      montantPaye: b.montantPaye == null ? undefined : Number(b.montantPaye),
      statut: b.statut === 'retire' ? 'retire' : b.statut === 'en_attente_paiement' ? 'a_payer' : 'reserve',
      creeLe: minutesMartinique(b.creeLe), date: b.creeLe?.toDate().toISOString(),
    }));
}

type DocMessage = { auteur: Message['auteur']; texte?: string; position?: Message['position']; audio?: { chemin: string; duree: number }; creeLe: Timestamp | null };
export async function chargerConversations(moi: string): Promise<Record<string, Conversation>> {
  const q = await essai(() => getDocs(query(collection(db(), 'conversations'), where('participants', 'array-contains', moi))));
  const r: Record<string, Conversation> = {};
  await Promise.all(q.docs.map(async (d) => {
    const c = d.data() as { etalId: string; clientId: string; clientPrenom: string; bonCode: string; luClient: boolean; luPecheur: boolean };
    const msgs = await getDocs(query(collection(db(), 'conversations', d.id, 'messages'), orderBy('creeLe')));
    const jeSuisClient = c.clientId === moi;
    const id = c.etalId + '|' + (jeSuisClient ? 'Vous' : d.id);
    r[id] = {
      id, uuid: d.id, etalId: c.etalId, client: jeSuisClient ? 'Vous' : c.clientPrenom, bon: c.bonCode ?? '', luClient: c.luClient, luPecheur: c.luPecheur,
      messages: msgs.docs.map((m) => {
        const x = m.data() as DocMessage;
        // message vocal : « fb: » + emplacement, téléchargé seulement au moment de l'écoute
        return { id: m.id, auteur: x.auteur, texte: x.texte, position: x.position, audio: x.audio ? { uri: 'fb:' + x.audio.chemin, duree: x.audio.duree } : undefined, heure: minutesMartinique(x.creeLe ?? new Date()) };
      }),
    };
  }));
  return r;
}

type DocDemande = { proId: string; proRaison: string; proType: InfosPro['type']; proCommune: string; espece: string; kg: number; prixMaxKg: number; pour: Demande['pour']; note?: string; livraison?: Demande['livraison']; statut: Demande['statut']; etalId?: string; bonCode?: string; creeLe: Timestamp | null };
export async function chargerDemandes(moi: string): Promise<Demande[]> {
  const c = await droits();
  const qs = [];
  if (c?.role === 'pro') qs.push(query(collection(db(), 'demandes'), where('proId', '==', moi)));
  if (c?.role === 'pecheur' && c.verifie) qs.push(query(collection(db(), 'demandes'), where('statut', '==', 'ouverte')));
  if (c?.role === 'pecheur' && c.etalId) qs.push(query(collection(db(), 'demandes'), where('etalId', '==', c.etalId)));
  const docs = (await Promise.all(qs.map((q) => essai(() => getDocs(q))))).flatMap((r) => r.docs);
  const vus = new Set<string>();
  return docs.filter((d) => !vus.has(d.id) && !!vus.add(d.id)).map((d) => ({ id: d.id, ...(d.data() as DocDemande) }))
    .filter((x) => x.statut !== 'annulee').sort((a, b) => (b.creeLe?.toMillis() ?? 0) - (a.creeLe?.toMillis() ?? 0))
    .map((x) => ({
      id: x.id, auteur: x.proId === moi ? 'Vous' : x.proRaison, pro: { raison: x.proRaison, type: x.proType, siret: '', commune: x.proCommune },
      espece: x.espece, kg: Number(x.kg), prixMaxKg: Number(x.prixMaxKg), pour: x.pour, note: x.note, livraison: x.livraison,
      statut: x.statut, etalId: x.etalId, bon: x.bonCode, creeLe: minutesMartinique(x.creeLe ?? new Date()),
    }));
}
export async function especesSuivies() {
  const u = await utilisateur(); if (!u) return [];
  return ((await getDoc(doc(db(), 'profils', u.uid))).data()?.suivis ?? []) as string[];
}

// Temps réel : la fonction est appelée dès qu'une donnée change (message, bon payé, arrivage…)
export function ecouterChangements(f: () => void): () => void {
  let minuteur: ReturnType<typeof setTimeout> | null = null;
  const plusTard = () => { if (minuteur) clearTimeout(minuteur); minuteur = setTimeout(f, 400); };
  let ecoutes: Unsubscribe[] = [];
  const arreter = () => { ecoutes.forEach((u) => u()); ecoutes = []; };
  const surErreur = () => { /* droits pas encore à jour : la prochaine connexion relancera l'écoute */ };
  const fin = onAuthStateChanged(auth(), async (u) => {
    arreter();
    ecoutes.push(onSnapshot(query(collection(db(), 'etals'), where('statut', '==', 'verifie'), where('stripePret', '==', true)), plusTard, surErreur));
    if (!u) return;
    const c = await droits();
    ecoutes.push(onSnapshot(query(collection(db(), 'conversations'), where('participants', 'array-contains', u.uid)), plusTard, surErreur));
    ecoutes.push(onSnapshot(query(collection(db(), 'bons'), where('clientId', '==', u.uid)), plusTard, surErreur));
    if (c?.role === 'pecheur') {
      ecoutes.push(onSnapshot(query(collection(db(), 'bons'), where('pecheurId', '==', u.uid)), plusTard, surErreur));
      if (c.etalId) ecoutes.push(onSnapshot(doc(db(), 'etals', c.etalId), plusTard, surErreur));
      if (c.verifie) ecoutes.push(onSnapshot(query(collection(db(), 'demandes'), where('statut', '==', 'ouverte')), plusTard, surErreur));
    }
    if (c?.role === 'pro') ecoutes.push(onSnapshot(query(collection(db(), 'demandes'), where('proId', '==', u.uid)), plusTard, surErreur));
  });
  return () => { fin(); arreter(); };
}

// ───────── Actions ─────────
async function ouvrir(url: string) {
  if (Platform.OS === 'web') { window.location.assign(url); return; }
  const WebBrowser = await import('expo-web-browser');
  await WebBrowser.openBrowserAsync(url);
}

export async function reserver(etalId: string, lignes: LignePanier[], creneau: string, livraison: boolean) {
  const r = await fonction<{ code: string; url: string }>('creerReservation', {
    etalId, creneau, livraison, lignes: lignes.map((l) => ({ produitId: l.produitId, kg: l.kg, preparation: l.preparation })),
  });
  await ouvrir(r.url); // page de paiement sécurisée de Stripe (empreinte bancaire)
  return r.code;
}
export async function payerBon(code: string) { const r = await fonction<{ url: string }>('payerBon', { code }); await ouvrir(r.url); }
export const monQr = async (code: string) => (await fonction<{ signature: string | null }>('monQr', { code })).signature;
export const verifierBon = (code: string, signature: string) => fonction<{ valide: boolean; client: string; creneau: string }>('verifierBon', { code, signature });
export const validerPesee = (code: string, poids: number[]) => fonction<{ montantPaye?: number; annule?: boolean }>('validerPesee', { code, poids });

async function moi() { const u = await utilisateur(); if (!u) throw new ErreurServeur('Session expirée, reconnectez-vous.'); return u.uid; }
export async function envoyerMessage(conv: string, auteur: 'client' | 'pecheur', texte?: string, position?: Message['position'], expireLe?: Date) {
  const m: Record<string, unknown> = { auteurId: await moi(), auteur, creeLe: serverTimestamp() };
  if (texte) m.texte = texte.slice(0, 1000);
  if (position) { m.position = { libelle: position.libelle, lat: position.lat, lon: position.lon }; m.positionExpireLe = Timestamp.fromDate(expireLe ?? new Date(Date.now() + 30 * 60000)); }
  await essai(() => addDoc(collection(db(), 'conversations', conv, 'messages'), m));
}
// Message vocal : fichier dans messages-audio/<conversation>/, puis message qui le référence
export async function envoyerAudio(conv: string, auteur: 'client' | 'pecheur', a: { uri: string; type: string; duree: number; donnees?: Blob }) {
  const corps = a.donnees ?? (await (await fetch(a.uri)).blob());
  const ext = a.type.includes('mp4') || a.type.includes('m4a') || a.type.includes('aac') ? 'm4a' : a.type.includes('ogg') ? 'ogg' : 'webm';
  const chemin = conv + '/' + Date.now() + '.' + ext;
  const uid = await moi();
  await essai(() => uploadBytes(ref(_st, 'messages-audio/' + chemin), corps, { contentType: a.type }));
  await essai(() => addDoc(collection(db(), 'conversations', conv, 'messages'), { auteurId: uid, auteur, audio: { chemin, duree: Math.max(1, Math.min(120, Math.round(a.duree))) }, creeLe: serverTimestamp() }));
}
// Adresse d'écoute d'un message vocal (fichier privé : droits vérifiés par les règles)
export async function lienAudio(chemin: string) {
  init();
  const r = ref(_st, 'messages-audio/' + chemin);
  if (Platform.OS === 'web') return URL.createObjectURL(await getBlob(r));
  return getDownloadURL(r);
}
export async function marquerLu(conv: string, role: 'client' | 'pecheur') {
  await updateDoc(doc(db(), 'conversations', conv), role === 'client' ? { luClient: true } : { luPecheur: true });
}

// Photo de la pêche : déposée dans arrivages/<étal>/, renvoie son emplacement
export async function envoyerPhoto(etalId: string, uri: string, type = 'image/jpeg') {
  const corps = await (await fetch(uri)).blob();
  const chemin = 'arrivages/' + etalId + '/' + Date.now() + (type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg');
  init();
  await essai(() => uploadBytes(ref(_st, chemin), corps, { contentType: type }));
  return chemin;
}
export async function publierArrivage(_etalId: string, lignes: { espece: string; prixKg: number; dispoKg: number; preparations: { nom: string; supplementKg: number }[] }[], photoChemin?: string) {
  await fonction('publierArrivage', { lignes, ...(photoChemin ? { photoChemin } : {}) });
}

export async function posterDemande(d: { espece: string; kg: number; prixMaxKg: number; pour: Demande['pour']; note?: string; livraison?: Demande['livraison'] }, pro: InfosPro) {
  const x: Record<string, unknown> = { proId: await moi(), proRaison: pro.raison, proType: pro.type, proCommune: pro.commune, espece: d.espece, kg: d.kg, prixMaxKg: d.prixMaxKg, pour: d.pour, statut: 'ouverte', creeLe: serverTimestamp() };
  if (d.note) x.note = d.note;
  if (d.livraison) x.livraison = d.livraison;
  await essai(() => addDoc(collection(db(), 'demandes'), x));
}
export async function annulerDemande(id: string) { await essai(() => updateDoc(doc(db(), 'demandes', id), { statut: 'annulee' })); }
export const accepterDemande = (id: string) => fonction<{ code: string }>('accepterDemande', { id });

export const comptePaiement = (action: 'lien' | 'etat') => fonction<{ url?: string; pret?: boolean }>('comptePaiement', { action });
export async function ouvrirComptePaiement() { const r = await comptePaiement('lien'); if (r.url) await ouvrir(r.url); }

export const exporterDonnees = () => fonction<Record<string, unknown>>('compte', { action: 'exporter' });
export async function supprimerCompte() { await fonction('compte', { action: 'supprimer' }); await signOut(auth()).catch(() => {}); }

// Espèces suivies (« prévenez-moi quand il y a du thazard »)
export async function suivre(espece: string, oui: boolean) {
  const uid = await moi();
  await essai(() => updateDoc(doc(db(), 'profils', uid), { suivis: oui ? arrayUnion(espece) : arrayRemove(espece) }));
}

// Notifications sur le téléphone (appli installée seulement)
export async function enregistrerNotifications() {
  if (Platform.OS === 'web') return;
  try {
    const Device = await import('expo-device');
    const N = await import('expo-notifications');
    if (!Device.isDevice) return;
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    const jeton = (await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await updateDoc(doc(db(), 'profils', await moi()), { jetons: arrayUnion(jeton) });
  } catch { /* notifications facultatives */ }
}
