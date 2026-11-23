// Mise en vente de l'arrivage par le pêcheur : contrôle du compte, listes fermées (espèces, préparations),
// prix, périodes de fermeture, photo de la pêche, alerte aux clients qui suivent ces espèces.
import { getDownloadURL, getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';
import { APPEL, connecte, db, erreur, FieldValue, limiter } from './commun';
import { notifier } from './notifier';
import { convertirPrecommandes } from './sorties';
import { cleProduit, produitValide, type Produit } from './formats';
import { especeConnue, fermetureActive, FERMETURES_CONNUES, type Fermeture } from './regles';


export const publierArrivage = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'arrivage', 30);
  const d = (req.data ?? {}) as { lignes: Record<string, unknown>[]; photoChemin?: string; limiteRetrait?: number; idEnvoi?: string };
  // réseau faible : l'appli renvoie le même arrivage avec le même identifiant ; appliqué une seule fois
  const idEnvoi = typeof d.idEnvoi === 'string' && /^[a-z0-9]{6,24}$/.test(d.idEnvoi) ? d.idEnvoi : null;
  if (!Array.isArray(d.lignes) || d.lignes.length > 30) throw erreur('invalid-argument', 'Arrivage invalide.');
  const etalRef = db.doc('etals/' + uid);
  const fermetures: Fermeture[] = [...FERMETURES_CONNUES, ...(await db.collection('fermetures').get()).docs.map((x) => x.data() as Fermeture)];
  let photoUrl: string | undefined;
  if (d.photoChemin) {
    if (!/^arrivages\/[A-Za-z0-9]+\/[A-Za-z0-9_.-]{1,60}$/.test(String(d.photoChemin)) || !String(d.photoChemin).startsWith('arrivages/' + uid + '/')) throw erreur('permission-denied', 'Photo invalide.');
    photoUrl = await getDownloadURL(getStorage().bucket().file(d.photoChemin));
  }

  // dans une transaction : une réservation simultanée ne peut pas être perdue (pas de survente)
  const { e, produits, deja } = await db.runTransaction(async (t) => {
    const e = (await t.get(etalRef)).data();
    if (!e || e.pecheurId !== uid) throw erreur('permission-denied', 'Réservé aux pêcheurs.');
    if (e.statut !== 'verifie' || !e.stripePret) throw erreur('failed-precondition', 'Compte pêcheur pas encore vérifié.');
    if (idEnvoi && e.dernierEnvoi === idEnvoi) return { e, produits: (e.produits ?? []) as Produit[], deja: true }; // déjà reçu : rien à refaire
    // même identifiant pour la même espèce vendue de la même façon (paniers en cours)
    const anciens = new Map((e.produits as Produit[] ?? []).map((p) => [cleProduit(p), p.id]));
    const vus = new Set<string>();
    const produits: Produit[] = [];
    d.lignes.forEach((l, i) => {
      const espece = especeConnue(l?.espece);
      if (!espece) throw erreur('invalid-argument', 'Espèce inconnue : choisissez-la dans la liste.');
      const p = produitValide(l ?? {}, espece);
      if (!p) return; // rien à vendre sur cette ligne
      const cle = cleProduit(p);
      if (vus.has(cle)) throw erreur('invalid-argument', 'En double : ' + espece + ' vendu deux fois de la même façon.');
      const f = fermetureActive(fermetures, espece, e.port);
      if (f) throw erreur('failed-precondition', 'Vente fermée : ' + espece + ' (' + f.motif + ').');
      vus.add(cle);
      produits.push({ ...p, id: anciens.get(cle) ?? uid.slice(0, 6) + '-' + Date.now().toString(36) + '-' + i });
    });
    const maj: Record<string, unknown> = { produits, debarqueLe: FieldValue.serverTimestamp(), ...(idEnvoi ? { dernierEnvoi: idEnvoi } : {}) };
    if (typeof d.limiteRetrait === 'number' && d.limiteRetrait >= 6 * 60 && d.limiteRetrait <= 20 * 60) maj.limiteRetrait = Math.round(d.limiteRetrait);
    if (photoUrl) maj.photoUrl = photoUrl;
    t.update(etalRef, maj as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
    return { e, produits, deja: false };
  });
  if (deja) return { produits: produits.length, doublon: true };

  // réservations faites avant la sortie : deviennent des bons à payer, dans l'ordre d'arrivée
  const sortie = await convertirPrecommandes(uid);

  // alerte « arrivage » aux clients qui suivent une de ces espèces (au plus toutes les 2 h par étal)
  const dernier = e.notifieLe?.toMillis?.() ?? 0;
  const especes = [...new Set(produits.map((p) => p.espece))];
  if (especes.length && Date.now() - dernier > 2 * 3600_000) {
    // + les clients qui ont ce pêcheur en favori
    const [suiveurs, fideles] = await Promise.all([
      db.collection('profils').where('suivis', 'array-contains-any', especes.slice(0, 30)).get(),
      db.collection('profils').where('favoris', 'array-contains', uid).get(),
    ]);
    await etalRef.update({ notifieLe: FieldValue.serverTimestamp() });
    const ids = [...new Set([...suiveurs.docs, ...fideles.docs].map((p) => p.id))].filter((id) => id !== uid);
    await notifier(ids, 'Arrivage chez ' + e.prenom + ' (' + e.port + ')',
      e.prenom + ' vient de débarquer : ' + especes.join(', ').toLowerCase(), { lien: '/etal/' + uid });
  }
  return { produits: produits.length, ...sortie };
});
