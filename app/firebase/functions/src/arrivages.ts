// Mise en vente de l'arrivage par le pêcheur : contrôle du compte, listes fermées (espèces, préparations),
// prix, périodes de fermeture, photo de la pêche, alerte aux clients qui suivent ces espèces.
import { getDownloadURL, getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';
import { APPEL, connecte, db, erreur, FieldValue, limiter } from './commun';
import { notifier } from './notifier';
import { especeConnue, fermetureActive, FERMETURES_CONNUES, preparationConnue, type Fermeture } from './regles';

type L = { espece: string; prixKg: number; dispoKg: number; preparations: { nom: string; supplementKg: number }[] };
type Produit = { id: string; espece: string; prixKg: number; dispoKg: number; preparations: { nom: string; supplementKg: number }[] };

export const publierArrivage = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'arrivage', 30);
  const d = (req.data ?? {}) as { lignes: L[]; photoChemin?: string; limiteRetrait?: number };
  if (!Array.isArray(d.lignes) || d.lignes.length > 20) throw erreur('invalid-argument', 'Arrivage invalide.');
  const etalRef = db.doc('etals/' + uid);
  const fermetures: Fermeture[] = [...FERMETURES_CONNUES, ...(await db.collection('fermetures').get()).docs.map((x) => x.data() as Fermeture)];
  let photoUrl: string | undefined;
  if (d.photoChemin) {
    if (!/^arrivages\/[A-Za-z0-9]+\/[A-Za-z0-9_.-]{1,60}$/.test(String(d.photoChemin)) || !String(d.photoChemin).startsWith('arrivages/' + uid + '/')) throw erreur('permission-denied', 'Photo invalide.');
    photoUrl = await getDownloadURL(getStorage().bucket().file(d.photoChemin));
  }

  // dans une transaction : une réservation simultanée ne peut pas être perdue (pas de survente)
  const { e, produits } = await db.runTransaction(async (t) => {
    const e = (await t.get(etalRef)).data();
    if (!e || e.pecheurId !== uid) throw erreur('permission-denied', 'Réservé aux pêcheurs.');
    if (e.statut !== 'verifie' || !e.stripePret) throw erreur('failed-precondition', 'Compte pêcheur pas encore vérifié.');
    const anciens = new Map((e.produits as Produit[] ?? []).map((p) => [p.espece, p.id])); // même identifiant pour la même espèce
    const vus = new Set<string>();
    const produits = d.lignes.filter((l) => Number(l?.dispoKg) > 0).map((l, i) => {
      const espece = especeConnue(l.espece);
      if (!espece) throw erreur('invalid-argument', 'Espèce inconnue : choisissez-la dans la liste.');
      if (vus.has(espece)) throw erreur('invalid-argument', 'Espèce en double : ' + espece + '.');
      const prixKg = Math.round(Number(l.prixKg) * 100) / 100; const dispoKg = Math.round(Number(l.dispoKg) * 10) / 10;
      if (!(prixKg > 0 && prixKg < 500) || !(dispoKg > 0 && dispoKg <= 1000)) throw erreur('invalid-argument', 'Prix ou quantité invalide pour ' + espece + '.');
      const f = fermetureActive(fermetures, espece, e.port);
      if (f) throw erreur('failed-precondition', 'Vente fermée : ' + espece + ' (' + f.motif + ').');
      vus.add(espece);
      const preparations = (Array.isArray(l.preparations) && l.preparations.length ? l.preparations : [{ nom: 'Entier', supplementKg: 0 }]).slice(0, 5)
        .map((p) => ({ nom: preparationConnue(p?.nom), supplementKg: Math.max(0, Math.min(50, Math.round((Number(p?.supplementKg) || 0) * 100) / 100)) }));
      if (preparations.some((p) => !p.nom)) throw erreur('invalid-argument', 'Préparation inconnue pour ' + espece + '.');
      return { id: anciens.get(espece) ?? uid.slice(0, 6) + '-' + Date.now().toString(36) + '-' + i, espece, prixKg, dispoKg, preparations: preparations as { nom: string; supplementKg: number }[] };
    });
    const maj: Record<string, unknown> = { produits, debarqueLe: FieldValue.serverTimestamp() };
    if (typeof d.limiteRetrait === 'number' && d.limiteRetrait >= 6 * 60 && d.limiteRetrait <= 20 * 60) maj.limiteRetrait = Math.round(d.limiteRetrait);
    if (photoUrl) maj.photoUrl = photoUrl;
    t.update(etalRef, maj as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
    return { e, produits };
  });

  // alerte « arrivage » aux clients qui suivent une de ces espèces (au plus toutes les 2 h par étal)
  const dernier = e.notifieLe?.toMillis?.() ?? 0;
  const especes = produits.map((p) => p.espece);
  if (especes.length && Date.now() - dernier > 2 * 3600_000) {
    const suiveurs = await db.collection('profils').where('suivis', 'array-contains-any', especes.slice(0, 30)).get();
    await etalRef.update({ notifieLe: FieldValue.serverTimestamp() });
    await notifier(suiveurs.docs.map((p) => p.id).filter((id) => id !== uid), 'Arrivage à ' + e.port,
      e.prenom + ' vient de débarquer : ' + especes.join(', ').toLowerCase(), { lien: '/etal/' + uid });
  }
  return { produits: produits.length };
});
