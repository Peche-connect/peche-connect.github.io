// Mise en vente de l'arrivage par le pêcheur : contrôle du compte, des prix, des périodes de fermeture,
// photo de la pêche, alerte aux clients qui suivent ces espèces.
import { getDownloadURL, getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';
import { connecte, db, erreur, FieldValue, REGION } from './commun';
import { notifier } from './notifier';
import { fermetureActive, FERMETURES_CONNUES, type Fermeture } from './regles';

type L = { espece: string; prixKg: number; dispoKg: number; preparations: { nom: string; supplementKg: number }[] };

export const publierArrivage = onCall({ region: REGION }, async (req) => {
  const uid = connecte(req);
  const d = req.data as { lignes: L[]; photoChemin?: string; limiteRetrait?: number };
  const q = await db.collection('etals').where('pecheurId', '==', uid).limit(1).get();
  if (q.empty) throw erreur('permission-denied', 'Réservé aux pêcheurs.');
  const etal = q.docs[0]; const e = etal.data();
  if (e.statut !== 'verifie' || !e.stripePret) throw erreur('failed-precondition', 'Compte pêcheur pas encore vérifié.');
  if (!Array.isArray(d.lignes) || d.lignes.length > 20) throw erreur('invalid-argument', 'Arrivage invalide.');

  const fermetures: Fermeture[] = [...FERMETURES_CONNUES, ...(await db.collection('fermetures').get()).docs.map((x) => x.data() as Fermeture)];
  const vus = new Set<string>();
  const produits = d.lignes.filter((l) => Number(l.dispoKg) > 0).map((l, i) => {
    const espece = String(l.espece ?? '').trim();
    const prixKg = Math.round(Number(l.prixKg) * 100) / 100; const dispoKg = Math.round(Number(l.dispoKg) * 10) / 10;
    if (!espece || espece.length > 40 || vus.has(espece)) throw erreur('invalid-argument', 'Espèce invalide ou en double : ' + espece);
    if (!(prixKg > 0 && prixKg < 500) || !(dispoKg > 0 && dispoKg <= 1000)) throw erreur('invalid-argument', 'Prix ou quantité invalide pour ' + espece + '.');
    const f = fermetureActive(fermetures, espece, e.port);
    if (f) throw erreur('failed-precondition', 'Vente fermée : ' + espece + ' (' + f.motif + ').');
    vus.add(espece);
    const preparations = (Array.isArray(l.preparations) && l.preparations.length ? l.preparations : [{ nom: 'Entier', supplementKg: 0 }]).slice(0, 5)
      .map((p) => ({ nom: String(p.nom).slice(0, 30), supplementKg: Math.max(0, Math.min(50, Number(p.supplementKg) || 0)) }));
    return { id: etal.id.slice(0, 6) + '-' + Date.now().toString(36) + '-' + i, espece, prixKg, dispoKg, preparations };
  });

  const maj: Record<string, unknown> = { produits, debarqueLe: FieldValue.serverTimestamp() };
  if (typeof d.limiteRetrait === 'number' && d.limiteRetrait >= 6 * 60 && d.limiteRetrait <= 20 * 60) maj.limiteRetrait = Math.round(d.limiteRetrait);
  if (d.photoChemin) {
    if (!String(d.photoChemin).startsWith('arrivages/' + etal.id + '/')) throw erreur('permission-denied', 'Photo invalide.');
    maj.photoUrl = await getDownloadURL(getStorage().bucket().file(d.photoChemin));
  }
  await etal.ref.update(maj);

  // alerte « arrivage » aux clients qui suivent une de ces espèces (au plus toutes les 2 h par étal)
  const dernier = e.notifieLe?.toMillis?.() ?? 0;
  const especes = produits.map((p) => p.espece);
  if (especes.length && Date.now() - dernier > 2 * 3600_000) {
    const suiveurs = await db.collection('profils').where('suivis', 'array-contains-any', especes.slice(0, 30)).get();
    await etal.ref.update({ notifieLe: FieldValue.serverTimestamp() });
    await notifier(suiveurs.docs.map((p) => p.id).filter((id) => id !== uid), 'Arrivage à ' + e.port,
      e.prenom + ' vient de débarquer : ' + especes.join(', ').toLowerCase(), { lien: '/etal/' + etal.id });
  }
  return { produits: produits.length };
});
