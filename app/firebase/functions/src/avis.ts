// Avis réels : un seul avis par bon retiré (poisson vraiment acheté et pesé), dans les 14 jours,
// note de 1 à 5 et commentaire facultatif (numéros masqués). La note de l'étal est calculée ici,
// jamais par l'appli. Avis publics : prénom du client, note, commentaire, date — rien d'autre.
import { onCall } from 'firebase-functions/v2/https';
import { APPEL, connecte, db, erreur, FieldValue, limiter } from './commun';
import { membreEquipe } from './equipe';
import { notifier } from './notifier';
import { CODE_BON, masquerNumeros, normaliser } from './regles';

export const DELAI_AVIS_JOURS = 14;

export const laisserAvis = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'avis', 20);
  const d = (req.data ?? {}) as { code?: string; note?: number; commentaire?: string };
  const code = String(d.code ?? '');
  const note = Number(d.note);
  if (!CODE_BON.test(code) || !Number.isInteger(note) || note < 1 || note > 5) throw erreur('invalid-argument', 'Note de 1 à 5 étoiles.');
  const commentaire = masquerNumeros(normaliser(d.commentaire).slice(0, 300)).texte;
  const bonRef = db.doc('bons/' + code);
  const etalId = await db.runTransaction(async (t) => {
    const b = (await t.get(bonRef)).data();
    if (!b || b.clientId !== uid) throw erreur('not-found', 'Bon introuvable.');
    if (b.statut !== 'retire') throw erreur('failed-precondition', 'Vous pourrez noter après le retrait de votre poisson.');
    if (b.avis) throw erreur('already-exists', 'Vous avez déjà donné votre avis sur cet achat.');
    const retire = b.retireLe?.toMillis?.() ?? 0;
    if (Date.now() - retire > DELAI_AVIS_JOURS * 86400_000) throw erreur('failed-precondition', 'Un avis se donne dans les ' + DELAI_AVIS_JOURS + ' jours après le retrait.');
    const etalRef = db.doc('etals/' + b.etalId);
    const e = (await t.get(etalRef)).data();
    if (!e) throw erreur('not-found', 'Étal introuvable.');
    const somme = Number(e.noteSomme ?? 0) + note; const nombre = Number(e.noteNombre ?? 0) + 1;
    t.set(db.doc('avis/' + code), { etalId: b.etalId, prenom: b.clientPrenom ?? 'Client', note, commentaire, le: FieldValue.serverTimestamp(), pro: !!b.pro });
    t.update(bonRef, { avis: note });
    t.update(etalRef, { noteSomme: somme, noteNombre: nombre, note: Math.round((somme / nombre) * 10) / 10, avis: nombre });
    return b.etalId as string;
  });
  const pecheur = (await db.doc('etals/' + etalId).get()).data()?.pecheurId;
  if (pecheur) await notifier([pecheur], 'Nouvel avis ' + '★'.repeat(note), commentaire ? commentaire.slice(0, 80) : 'Un client a noté son achat.', { lien: '/etal/' + etalId });
  return { ok: true };
});

// L'équipe retire un avis abusif (insultes, hors sujet) : la note de l'étal est recalculée
export const equipeRetirerAvis = onCall(APPEL, async (req) => {
  await membreEquipe(req);
  const code = String((req.data as { code?: string })?.code ?? '');
  if (!CODE_BON.test(code)) throw erreur('invalid-argument', 'Avis introuvable.');
  await db.runTransaction(async (t) => {
    const ref = db.doc('avis/' + code); const a = (await t.get(ref)).data();
    if (!a) throw erreur('not-found', 'Avis introuvable.');
    const etalRef = db.doc('etals/' + a.etalId); const e = (await t.get(etalRef)).data() ?? {};
    const somme = Math.max(0, Number(e.noteSomme ?? 0) - a.note); const nombre = Math.max(0, Number(e.noteNombre ?? 0) - 1);
    t.delete(ref);
    t.update(etalRef, { noteSomme: somme, noteNombre: nombre, note: nombre ? Math.round((somme / nombre) * 10) / 10 : 5, avis: nombre });
  });
  return { ok: true };
});
