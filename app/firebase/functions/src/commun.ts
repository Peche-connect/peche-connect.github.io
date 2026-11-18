// Outils communs aux fonctions serveur Pêche Connect (Firebase Cloud Functions, Node 20).
// Les clés secrètes sont des « secrets » Firebase (firebase functions:secrets:set …), jamais dans le code.
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import Stripe from 'stripe';

initializeApp();
export const db = getFirestore();
export { FieldValue, Timestamp };

// Serveurs à Paris (même région que la base)
export const REGION = 'europe-west9';

// Anti-robots (Firebase App Check) : seuls le site et l'appli officiels peuvent appeler les fonctions.
// Désactivé seulement dans les émulateurs (tests) ; « APPCHECK=desactive » dans functions/.env en dépannage.
export const APPCHECK = process.env.FUNCTIONS_EMULATOR !== 'true' && process.env.APPCHECK !== 'desactive';
export const APPEL = { region: REGION, enforceAppCheck: APPCHECK } as const;

export const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
export const STRIPE_WEBHOOK_SECRET_CONNECT = defineSecret('STRIPE_WEBHOOK_SECRET_CONNECT');
export const QR_SECRET = defineSecret('QR_SECRET');
export const SITE_URL = defineString('SITE_URL', { default: 'https://peche-connect.fr' });

export const site = () => SITE_URL.value().replace(/\/$/, '');

// Stripe. Pendant les tests automatiques seulement (émulateur), on peut viser « stripe-mock »,
// une copie locale de Stripe : jamais possible une fois en ligne.
export function stripe() {
  const hote = process.env.FUNCTIONS_EMULATOR === 'true' ? process.env.STRIPE_API_HOTE : undefined;
  return new Stripe(STRIPE_SECRET_KEY.value(), {
    apiVersion: '2025-02-24.acacia',
    ...(hote ? { host: hote.split(':')[0], port: Number(hote.split(':')[1] ?? 12111), protocol: 'http' as const } : {}),
  });
}

export const centimes = (euros: number) => Math.round(euros * 100);
export const arrondi = (n: number) => Math.round(n * 100) / 100;

// Erreurs lisibles par l'appli (le message est affiché tel quel)
export const erreur = (code: 'unauthenticated' | 'permission-denied' | 'not-found' | 'failed-precondition' | 'invalid-argument' | 'already-exists' | 'resource-exhausted', message: string) =>
  new HttpsError(code, message);

export function connecte(req: CallableRequest): string {
  if (!req.auth) throw erreur('unauthenticated', 'Connectez-vous pour continuer.');
  return req.auth.uid;
}

export type Reglages = { fraisService: number; commissionPct: number; margeEmpreinte: number; livraisonMinKg: number; fraisLivraison: number; tvaProduitsMer: number; delaiPositionMin: number };
export const REGLAGES_DEFAUT: Reglages = { fraisService: 0.9, commissionPct: 0, margeEmpreinte: 0.1, livraisonMinKg: 10, fraisLivraison: 15, tvaProduitsMer: 0.021, delaiPositionMin: 30 };
export async function reglages(): Promise<Reglages> {
  const d = await db.doc('reglages/general').get();
  return { ...REGLAGES_DEFAUT, ...(d.exists ? d.data() : {}) } as Reglages;
}

export async function journal(qui: string | null, quoi: string, details?: unknown) {
  await db.collection('journal').add({ quand: FieldValue.serverTimestamp(), qui, quoi, details: details ?? null });
}
// Événement de sécurité : gardé dans le journal ET écrit dans les journaux Google avec le mot
// « ALERTE_SECURITE », qui déclenche un e-mail aux associés (alerte Cloud Monitoring, voir MISE-EN-SERVICE.md)
export async function alerte(qui: string | null, quoi: string, details?: unknown) {
  logger.warn('ALERTE_SECURITE ' + quoi, { qui, details: details ?? null });
  await journal(qui, quoi, details);
}

// La Martinique est à UTC−4 toute l'année
export const maintenantMartinique = () => { const d = new Date(); return (((d.getUTCHours() - 4) * 60 + d.getUTCMinutes()) % 1440 + 1440) % 1440; };

// Limite de cadence par personne et par action (ex. 10 réservations par heure) : contre les abus et les robots
export async function limiter(uid: string, action: string, max: number, fenetreSec = 3600) {
  const ref = db.doc('limites/' + uid + '_' + action);
  const maintenant = Date.now();
  await db.runTransaction(async (t) => {
    const recents = (((await t.get(ref)).data()?.horodatages ?? []) as number[]).filter((x) => x > maintenant - fenetreSec * 1000);
    if (recents.length >= max) { logger.warn('ALERTE_SECURITE cadence dépassée', { uid, action }); throw erreur('resource-exhausted', 'Trop de demandes en peu de temps. Réessayez dans quelques minutes.'); }
    t.set(ref, { horodatages: [...recents, maintenant], maj: FieldValue.serverTimestamp() });
  });
}

export const CODE_BON_OK = (c: string) => /^R-\d{1,9}$/.test(c);
// Dépannage seulement : si l'anti-robots est coupé en production, on le signale à chaque démarrage
if (process.env.FUNCTIONS_EMULATOR !== 'true' && process.env.APPCHECK === 'desactive') logger.error('ALERTE_SECURITE App Check désactivé sur les fonctions serveur');
