// Réservations avant la sortie : le pêcheur annonce « je sors demain matin, je pense ramener du thon »,
// les clients réservent des kilos (sans payer). À son retour, quand il publie son arrivage, chaque
// réservation devient un bon « à payer dans l'heure », dans l'ordre d'arrivée, tant qu'il y a du poisson.
//  sorties/<etalId>     : une sortie annoncée par étal (publique)
//  precommandes/<id>    : les réservations avant la sortie (client et pêcheur concernés seulement)
import { onCall } from 'firebase-functions/v2/https';
import { APPEL, connecte, db, erreur, FieldValue, journal, limiter, reglages, Timestamp } from './commun';
import { formatDe, prendre, type LigneBon, type Produit } from './formats';
import { ajouterEtape } from './historique';
import { notifier } from './notifier';
import { creneaux, especeConnue, fermetureActive, FERMETURES_CONNUES, montantBloque, nomPropre, type Fermeture } from './regles';
import { KG_MAX_PARTICULIER, KG_MAX_PRO, prochainCode } from './reservations';

export const DELAI_PAIEMENT_SORTIE_MIN = 60; // le client a une heure pour payer après le retour
const r1 = (n: number) => Math.round(n * 10) / 10;
type EspeceSortie = { espece: string; prixKg: number; kgMax: number };

// Le pêcheur annonce (ou met à jour) sa prochaine sortie
export const annoncerSortie = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'sortie', 20);
  if (req.auth?.token.role !== 'pecheur' || req.auth?.token.verifie !== true) throw erreur('permission-denied', 'Réservé aux pêcheurs vérifiés.');
  const d = (req.data ?? {}) as { retour?: string; especes?: Partial<EspeceSortie>[] };
  const retour = Date.parse(String(d.retour ?? ''));
  if (!(retour > Date.now() + 30 * 60_000 && retour < Date.now() + 48 * 3600_000)) throw erreur('invalid-argument', 'Heure de retour : entre 30 minutes et 48 heures.');
  if (!Array.isArray(d.especes) || !d.especes.length || d.especes.length > 8) throw erreur('invalid-argument', 'Indiquez de 1 à 8 espèces.');
  const etalRef = db.doc('etals/' + uid);
  const e = (await etalRef.get()).data();
  if (!e) throw erreur('not-found', 'Étal introuvable.');
  const fermetures: Fermeture[] = [...FERMETURES_CONNUES, ...(await db.collection('fermetures').get()).docs.map((x) => x.data() as Fermeture)];
  const especes: EspeceSortie[] = d.especes.map((x) => {
    const espece = especeConnue(x?.espece);
    const prixKg = Math.round(Number(x?.prixKg) * 100) / 100, kgMax = r1(Number(x?.kgMax));
    if (!espece) throw erreur('invalid-argument', 'Espèce inconnue : choisissez-la dans la liste.');
    if (!(prixKg > 0 && prixKg < 500) || !(kgMax >= 1 && kgMax <= 500)) throw erreur('invalid-argument', 'Prix ou quantité invalide pour ' + espece + '.');
    const f = fermetureActive(fermetures, espece, e.port);
    if (f) throw erreur('failed-precondition', 'Vente fermée : ' + espece + ' (' + f.motif + ').');
    return { espece, prixKg, kgMax };
  });
  if (new Set(especes.map((x) => x.espece)).size !== especes.length) throw erreur('invalid-argument', 'Une espèce apparaît deux fois.');
  const ref = db.doc('sorties/' + uid);
  const nouvelle = await db.runTransaction(async (t) => {
    const s = (await t.get(ref)).data();
    const enCours = s?.statut === 'annoncee';
    const reserve: Record<string, number> = enCours ? s.reserveKg ?? {} : {};
    // on ne retire pas une espèce déjà réservée, et on ne descend pas sous ce qui est réservé
    for (const [esp, kg] of Object.entries(reserve)) {
      const x = especes.find((y) => y.espece === esp);
      if (kg > 0 && (!x || x.kgMax < kg)) throw erreur('failed-precondition', esp + ' : ' + String(kg).replace('.', ',') + ' kg déjà réservés par des clients.');
    }
    t.set(ref, {
      etalId: uid, pecheurId: uid, prenom: e.prenom ?? '', port: e.port ?? '', bateau: e.bateau ?? '',
      retour: Timestamp.fromMillis(retour), especes, reserveKg: reserve, statut: 'annoncee',
      creeLe: enCours ? s.creeLe : FieldValue.serverTimestamp(), majLe: FieldValue.serverTimestamp(),
    });
    return !enCours;
  });
  if (nouvelle) {
    // alerte aux clients qui suivent une de ces espèces
    const [suiveurs, fideles] = await Promise.all([
      db.collection('profils').where('suivis', 'array-contains-any', especes.map((x) => x.espece)).get(),
      db.collection('profils').where('favoris', 'array-contains', uid).get(), // clients qui l'ont en favori
    ]);
    await notifier([...new Set([...suiveurs.docs, ...fideles.docs].map((p) => p.id))].filter((id) => id !== uid), (e.prenom ?? 'Un pêcheur') + ' part en mer',
      'Retour prévu ' + heureMq(retour) + ' : ' + especes.map((x) => x.espece.toLowerCase()).join(', ') + '. Réservez avant son retour.', { lien: '/sortie/' + uid });
  }
  return { ok: true };
});

const heureMq = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'America/Martinique', weekday: 'long', hour: '2-digit', minute: '2-digit' });

// Le client réserve des kilos avant le retour (sans payer : il paiera à l'arrivée)
export const precommander = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  if (req.auth?.token.email_verified !== true) throw erreur('failed-precondition', 'Confirmez votre adresse e-mail avant de réserver.');
  await limiter(uid, 'precommande', 10);
  const d = (req.data ?? {}) as { etalId?: string; espece?: string; kg?: number };
  const etalId = String(d.etalId ?? ''), kg = r1(Number(d.kg));
  if (!/^[A-Za-z0-9]{1,40}$/.test(etalId) || !(kg >= 0.5)) throw erreur('invalid-argument', 'Réservation invalide.');
  if (etalId === uid) throw erreur('failed-precondition', 'Vous ne pouvez pas réserver sur votre propre étal.');
  const [profil, pro] = await Promise.all([db.doc('profils/' + uid).get(), db.doc('pros/' + uid).get()]);
  if (!profil.exists) throw erreur('failed-precondition', 'Terminez votre inscription avant de réserver.');
  if (kg > (pro.exists ? KG_MAX_PRO : KG_MAX_PARTICULIER)) throw erreur('invalid-argument', 'Au plus ' + (pro.exists ? KG_MAX_PRO : KG_MAX_PARTICULIER) + ' kg par réservation.');
  const ref = db.doc('sorties/' + etalId);
  const id = await db.runTransaction(async (t) => {
    const s = (await t.get(ref)).data();
    if (!s || s.statut !== 'annoncee') throw erreur('failed-precondition', 'Cette sortie n’est plus ouverte aux réservations.');
    if (s.retour.toMillis() < Date.now() - 6 * 3600_000) throw erreur('failed-precondition', 'Le pêcheur aurait dû rentrer : attendez son arrivage.');
    const x = (s.especes as EspeceSortie[]).find((y) => y.espece === d.espece);
    if (!x) throw erreur('invalid-argument', 'Espèce non annoncée pour cette sortie.');
    const miennes = await t.get(db.collection('precommandes').where('clientId', '==', uid).where('statut', '==', 'en_attente'));
    if (miennes.size >= 3) throw erreur('resource-exhausted', 'Au plus 3 réservations avant sortie à la fois.');
    if (miennes.docs.some((m) => m.data().etalId === etalId && m.data().espece === x.espece)) throw erreur('already-exists', 'Vous avez déjà réservé cette espèce : annulez-la pour changer la quantité.');
    const deja = Number(s.reserveKg?.[x.espece] ?? 0);
    if (deja + kg > x.kgMax) throw erreur('failed-precondition', 'Plus que ' + String(r1(Math.max(0, x.kgMax - deja))).replace('.', ',') + ' kg de ' + x.espece.toLowerCase() + ' à réserver.');
    const p = db.collection('precommandes').doc();
    t.set(p, { etalId, clientId: uid, clientPrenom: nomPropre(profil.data()?.prenom, 1, 40) ?? 'Client', pro: pro.exists, espece: x.espece, kg, prixKg: x.prixKg,
      statut: 'en_attente', bonCode: null, creeLe: FieldValue.serverTimestamp() });
    t.update(ref, { ['reserveKg.' + x.espece]: r1(deja + kg) });
    return p.id;
  });
  return { id };
});

// Le client annule sa réservation avant sortie (tant qu'elle n'est pas devenue un bon)
export const annulerPrecommande = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  const id = String((req.data as { id?: string })?.id ?? '');
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) throw erreur('invalid-argument', 'Réservation introuvable.');
  await db.runTransaction(async (t) => {
    const ref = db.doc('precommandes/' + id); const p = (await t.get(ref)).data();
    if (!p || p.clientId !== uid) throw erreur('not-found', 'Réservation introuvable.');
    if (p.statut !== 'en_attente') throw erreur('failed-precondition', 'Cette réservation est déjà traitée.');
    const sRef = db.doc('sorties/' + p.etalId); const s = (await t.get(sRef)).data();
    t.update(ref, { statut: 'annulee' });
    if (s?.statut === 'annoncee') t.update(sRef, { ['reserveKg.' + p.espece]: r1(Math.max(0, Number(s.reserveKg?.[p.espece] ?? 0) - p.kg)) });
  });
  return { ok: true };
});

// Le pêcheur annule sa sortie (mauvais temps, panne) : les clients sont prévenus
export const annulerSortie = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  const ref = db.doc('sorties/' + uid);
  const s = (await ref.get()).data();
  if (!s || s.statut !== 'annoncee') throw erreur('failed-precondition', 'Aucune sortie annoncée.');
  const motif = String((req.data as { motif?: string })?.motif ?? '').slice(0, 100);
  await ref.update({ statut: 'annulee' });
  const ps = await db.collection('precommandes').where('etalId', '==', uid).where('statut', '==', 'en_attente').get();
  const lot = db.batch(); ps.docs.forEach((p) => lot.update(p.ref, { statut: 'non_servie', raison: 'sortie annulée' })); await lot.commit();
  await notifier([...new Set(ps.docs.map((p) => p.data().clientId as string))], 'Sortie annulée',
    s.prenom + ' ne sort pas finalement' + (motif ? ' (' + motif + ')' : '') + '. Rien ne vous a été débité.', { lien: '/bons' });
  return { ok: true };
});

// Au retour (arrivage publié) : chaque réservation devient un bon à payer, dans l'ordre d'arrivée
export async function convertirPrecommandes(etalId: string) {
  const sRef = db.doc('sorties/' + etalId);
  const s = (await sRef.get()).data();
  if (!s || s.statut !== 'annoncee') return { converties: 0, nonServies: 0 };
  await sRef.update({ statut: 'rentree', rentreeLe: FieldValue.serverTimestamp() });
  const ps = (await db.collection('precommandes').where('etalId', '==', etalId).where('statut', '==', 'en_attente').get()).docs
    .sort((a, b) => (a.data().creeLe?.toMillis?.() ?? 0) - (b.data().creeLe?.toMillis?.() ?? 0));
  const r = await reglages();
  let converties = 0, nonServies = 0;
  for (const p of ps) {
    const pc = p.data();
    const res = await db.runTransaction(async (t) => {
      const etalRef = db.doc('etals/' + etalId);
      const [etal, pro, cur] = await Promise.all([t.get(etalRef).then((x) => x.data()), pc.pro ? t.get(db.doc('pros/' + pc.clientId)).then((x) => x.data()) : Promise.resolve(undefined), t.get(p.ref).then((x) => x.data())]);
      if (!etal || cur?.statut !== 'en_attente') return null;
      const produits: Produit[] = JSON.parse(JSON.stringify(etal.produits ?? []));
      const auKilo = produits.find((x) => x.espece === pc.espece && formatDe(x) === 'kilo' && x.dispoKg >= 0.5);
      if (!auKilo) {
        const autre = produits.some((x) => x.espece === pc.espece);
        t.update(p.ref, { statut: 'non_servie', raison: autre ? 'vendu autrement (à la pièce ou en barquettes)' : 'pas pêché' });
        return { ok: false, autre };
      }
      const kg = r1(Math.min(pc.kg, auKilo.dispoKg));
      const ligne: LigneBon = prendre(auKilo, { kg });
      const lignes = [ligne];
      const liste = creneaux(Number(etal.limiteRetrait ?? 720));
      const code = await prochainCode(t);
      const bloque = montantBloque(r, lignes, 0);
      t.update(etalRef, { produits });
      t.set(db.doc('bons/' + code), {
        code, origine: 'sortie', etalId, pecheurId: etal.pecheurId, clientId: pc.clientId, clientPrenom: pc.clientPrenom,
        pro: pro ? { raison: pro.raison, type: pro.type, siret: pro.siret, commune: pro.commune } : null,
        livraison: null, chauffeurId: null, lignes, creneau: liste[0], statut: 'en_attente_paiement', montantBloque: bloque, montantPaye: null, commission: null,
        creeLe: FieldValue.serverTimestamp(), payeLe: null, retireLe: null, rappelEnvoye: false, facture: null,
        ...ajouterEtape(t, code, undefined, 'reservee', { uid: null, role: 'systeme' }, { kg, montantBloque: bloque, creneau: liste[0], precommande: p.id }),
      });
      t.update(p.ref, { statut: 'convertie', bonCode: code, kgServi: kg });
      return { ok: true, code, kg, prixKg: ligne.prixKg };
    });
    if (!res) continue;
    if (res.ok && 'code' in res) {
      converties++;
      const partiel = res.kg! < pc.kg ? ' (' + String(res.kg).replace('.', ',') + ' kg sur ' + String(pc.kg).replace('.', ',') + ')' : '';
      await notifier([pc.clientId], 'Votre ' + pc.espece.toLowerCase() + ' est arrivé',
        'Réservé pour vous' + partiel + ' à ' + String(res.prixKg).replace('.', ',') + ' €/kg. Payez dans l’heure pour le garder.', { lien: '/bon/' + res.code });
    } else {
      nonServies++;
      await notifier([pc.clientId], 'Pas de ' + pc.espece.toLowerCase() + ' cette fois',
        res.autre ? s.prenom + ' le vend à la pièce ou en barquettes : choisissez directement sur son étal.' : s.prenom + ' n’en a pas ramené. Rien ne vous a été débité.', { lien: '/etal/' + etalId });
    }
  }
  await journal(null, 'sortie rentrée', { etalId, converties, nonServies });
  return { converties, nonServies };
}
