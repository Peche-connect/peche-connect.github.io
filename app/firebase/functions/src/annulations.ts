// Règles d'annulation (PROVISOIRES : montants et délais dans reglages/general, à décider entre associés)
//  - le client annule lui-même : gratuit jusqu'à « annulationClientAvantMin » minutes avant l'heure limite de retrait ;
//  - le pêcheur est en rupture : bon annulé, rien n'est débité, poisson pas remis en vente ; au-delà de
//    « rupturesAlerte » ruptures sur 30 jours, l'équipe est prévenue (signalement automatique) ;
//  - client absent : « absentApresMin » minutes après l'heure limite, le pêcheur peut le déclarer ; une part
//    « penaliteAbsencePct » du poisson réservé est débitée (dédommagement du pêcheur), le reste est libéré,
//    le poisson est remis en vente ;
//  - bon jamais clôturé : rappel au pêcheur le lendemain ; au bout de 6 jours (l'empreinte bancaire expire à 7),
//    bon annulé sans frais pour le client.
import { onCall } from 'firebase-functions/v2/https';
import { APPEL, centimes, connecte, db, erreur, FieldValue, journal, limiter, reglages, stripe, STRIPE_SECRET_KEY, Timestamp } from './commun';
import { type LigneBon } from './formats';
import { ajouterEtape, type Auteur } from './historique';
import { notifier } from './notifier';
import { CODE_BON, sousTotal } from './regles';
import { annulerBon } from './reservations';

const MQ = 4 * 60; // Martinique : UTC−4, sans heure d'été
export const minutesMq = (ms = Date.now()) => (((Math.floor(ms / 60_000) - MQ) % 1440) + 1440) % 1440;
export const jourMq = (ms = Date.now()) => new Date(ms - MQ * 60_000).toISOString().slice(0, 10);
const euros = (n: number) => n.toFixed(2).replace('.', ',') + ' €';

async function lireBon(code: unknown) {
  if (typeof code !== 'string' || !CODE_BON.test(code)) throw erreur('invalid-argument', 'Bon introuvable.');
  const ref = db.doc('bons/' + code);
  const b = (await ref.get()).data();
  if (!b) throw erreur('not-found', 'Bon introuvable.');
  const paiement = (await db.doc('bonsSecrets/' + code).get()).data()?.stripePaiement as string | undefined;
  return { ref, b, paiement };
}
// Heure limite de retrait du bon (minutes dans la journée, heure de Martinique) et jour du paiement
async function limiteDuBon(b: FirebaseFirestore.DocumentData) {
  const e = (await db.doc('etals/' + b.etalId).get()).data();
  return { limite: Number(e?.limiteRetrait ?? 720), jour: jourMq(b.payeLe?.toMillis?.() ?? b.creeLe?.toMillis?.() ?? Date.now()) };
}
// L'heure limite (avec une marge en minutes) est-elle passée ?
const depasse = (l: { limite: number; jour: string }, marge: number) => jourMq() > l.jour || (jourMq() === l.jour && minutesMq() >= l.limite + marge);

// Le client annule sa réservation (gratuit jusqu'à N minutes avant l'heure limite)
export const annulerParClient = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'annulation', 10);
  const code = (req.data as { code?: string })?.code;
  const { b, paiement } = await lireBon(code);
  if (b.clientId !== uid) throw erreur('not-found', 'Bon introuvable.');
  if (b.statut === 'en_attente_paiement') { await annulerBon(code!, 'annulé par le client avant paiement', { uid, role: b.pro ? 'pro' : 'client' }); return { ok: true, debite: 0 }; }
  if (b.statut !== 'reserve') throw erreur('failed-precondition', 'Ce bon ne peut plus être annulé.');
  const r = await reglages();
  if (depasse(await limiteDuBon(b), -r.annulationClientAvantMin)) {
    throw erreur('failed-precondition', 'Trop tard pour annuler en ligne (moins de ' + r.annulationClientAvantMin + ' min avant la fin du retrait) : prévenez le pêcheur par message.');
  }
  if (paiement) await stripe().paymentIntents.cancel(paiement).catch(() => {});
  await annulerBon(code!, 'annulé par le client', { uid, role: b.pro ? 'pro' : 'client' });
  await notifier([b.pecheurId], 'Réservation ' + code + ' annulée', b.clientPrenom + ' a annulé : le poisson est remis en vente.');
  return { ok: true, debite: 0 };
});

// Le pêcheur ne peut pas fournir (rupture) : rien n'est débité au client
export const annulerParPecheur = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'annulation', 20);
  const code = (req.data as { code?: string })?.code;
  const { ref, b, paiement } = await lireBon(code);
  if (b.pecheurId !== uid) throw erreur('not-found', 'Bon introuvable.');
  if (!['reserve', 'en_attente_paiement', 'en_livraison'].includes(b.statut)) throw erreur('failed-precondition', 'Ce bon est déjà clôturé.');
  if (paiement) await stripe().paymentIntents.cancel(paiement).catch(() => {});
  const pecheur: Auteur = { uid, role: 'pecheur' };
  // poisson pas remis en vente : il n'existe plus
  await db.runTransaction(async (t) => {
    const x = (await t.get(ref)).data();
    if (!x || !['reserve', 'en_attente_paiement', 'en_livraison'].includes(x.statut)) throw erreur('failed-precondition', 'Ce bon est déjà clôturé.');
    t.update(ref, { statut: 'annule', montantPaye: 0, ...ajouterEtape(t, code!, x, 'annulee', pecheur, { raison: 'rupture du pêcheur', debite: 0 }) });
    t.update(db.doc('etals/' + b.etalId), { ruptures: FieldValue.arrayUnion(Timestamp.now()) });
  });
  await notifier([b.clientId], 'Réservation ' + code + ' annulée', 'Le pêcheur n’a plus ce poisson. Rien ne vous a été débité.');
  // trop de ruptures : l'équipe est prévenue
  const r = await reglages();
  const e = (await db.doc('etals/' + b.etalId).get()).data();
  const recentes = ((e?.ruptures ?? []) as Timestamp[]).filter((x) => x.toMillis() > Date.now() - 30 * 86400_000);
  if (recentes.length >= r.rupturesAlerte) {
    await db.collection('signalements').add({ conv: null, bonCode: code, par: null, contre: uid, motif: recentes.length + ' ruptures en 30 jours (automatique)', bloquer: false, le: FieldValue.serverTimestamp(), traite: false });
  }
  return { ok: true };
});

// Débite la pénalité d'absence (ou libère tout si elle est à 0) et remet le poisson en vente
export async function clotureAbsence(code: string, par: Auteur, penaliteActive: boolean) {
  const { ref, b, paiement } = await lireBon(code);
  if (b.statut !== 'reserve') return { debite: 0 };
  const r = await reglages();
  const debite = penaliteActive ? Math.min(b.montantBloque, Math.round(sousTotal(b.lignes as LigneBon[]) * r.penaliteAbsencePct * 100) / 100) : 0;
  await db.runTransaction(async (t) => {
    const x = (await t.get(ref)).data();
    if (x?.statut !== 'reserve') throw erreur('failed-precondition', 'Ce bon est déjà clôturé.');
    t.update(ref, { statut: 'absence_en_cours' });
  });
  try {
    if (paiement) {
      if (debite > 0) await stripe().paymentIntents.capture(paiement, { amount_to_capture: centimes(debite), application_fee_amount: 0 });
      else await stripe().paymentIntents.cancel(paiement);
    }
  } catch (e) { await ref.update({ statut: 'reserve' }); throw e; }
  await ref.update({ statut: 'reserve' }); // annulerBon remet le poisson en vente depuis l'état « réservé »
  await annulerBon(code, debite ? 'client absent' : 'bon non clôturé', par);
  await ref.update({ montantPaye: debite, penaliteAbsence: debite });
  return { debite, b };
}

// Le pêcheur déclare le client absent, après l'heure limite (+ marge)
export const clientAbsent = onCall({ ...APPEL, secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'annulation', 20);
  const code = (req.data as { code?: string })?.code;
  const { b } = await lireBon(code);
  if (b.pecheurId !== uid) throw erreur('not-found', 'Bon introuvable.');
  if (b.statut !== 'reserve') throw erreur('failed-precondition', 'Ce bon est déjà clôturé.');
  const r = await reglages();
  if (!depasse(await limiteDuBon(b), r.absentApresMin)) throw erreur('failed-precondition', 'Attendez ' + r.absentApresMin + ' min après l’heure limite de retrait avant de déclarer le client absent.');
  const { debite } = await clotureAbsence(code!, { uid, role: 'pecheur' }, true);
  await journal(uid, 'client absent', { code, debite });
  await notifier([b.clientId], 'Réservation ' + code + ' non retirée',
    debite ? euros(debite) + ' débités pour dédommager le pêcheur (règles d’annulation). Le reste est libéré.' : 'Rien ne vous a été débité.');
  return { debite };
});
