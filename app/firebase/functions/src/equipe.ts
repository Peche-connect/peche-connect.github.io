// Espace équipe (administration) : vérifier les pêcheurs (numéro de marin, immatriculation),
// traiter les signalements, retrouver les factures. Réservé aux adresses e-mail listées dans
// reglages/equipe (champ « emails », modifiable seulement depuis la console Firebase), e-mail confirmé.
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { APPEL, connecte, db, erreur, FieldValue, journal, limiter } from './commun';
import { notifier } from './notifier';
import { normaliser } from './regles';

export async function membreEquipe(req: CallableRequest): Promise<{ uid: string; email: string }> {
  const uid = connecte(req);
  const email = String(req.auth?.token.email ?? '').toLowerCase();
  const liste = ((await db.doc('reglages/equipe').get()).data()?.emails ?? []) as string[];
  if (!email || req.auth?.token.email_verified !== true || !liste.map((x) => String(x).toLowerCase()).includes(email)) {
    throw erreur('permission-denied', 'Réservé à l’équipe Pêche Connect.');
  }
  await limiter(uid, 'equipe', 300);
  return { uid, email };
}

const date = (x: unknown) => (x as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? null;

// Tout ce qui attend l'équipe, en un appel
export const equipeTableau = onCall(APPEL, async (req) => {
  await membreEquipe(req);
  const [attente, signalements, factures, avis] = await Promise.all([
    db.collection('etals').where('statut', '==', 'en_attente').limit(50).get(),
    db.collection('signalements').where('traite', '==', false).limit(50).get(),
    db.collection('factures').orderBy('emiseLe', 'desc').limit(30).get(),
    db.collection('avis').orderBy('le', 'desc').limit(30).get(),
  ]);
  const dossiers = await Promise.all(attente.docs.map(async (d) => {
    const e = d.data();
    const [prive, dossier] = await Promise.all([d.ref.collection('prive').doc('infos').get(), d.ref.collection('verification').doc('dossier').get()]);
    return {
      etalId: d.id, prenom: e.prenom ?? '', port: e.port ?? '', bateau: e.bateau ?? '', stripePret: e.stripePret === true, creeLe: date(e.creeLe),
      immatriculation: prive.data()?.immatriculation ?? '', nomLegal: prive.data()?.nomLegal ?? null,
      numeroMarin: dossier.data()?.numeroMarin ?? '', motifRefus: dossier.data()?.motifRefus ?? null,
    };
  }));
  const prenom = async (uid: string | null) => {
    if (!uid) return { prenom: '?', role: '?' };
    const [p, e] = await Promise.all([db.doc('profils/' + uid).get(), db.doc('etals/' + uid).get()]);
    return e.exists ? { prenom: e.data()?.prenom ?? '?', role: 'pêcheur' } : { prenom: p.data()?.prenom ?? '?', role: p.data()?.role ?? 'client' };
  };
  const sig = await Promise.all(signalements.docs.map(async (d) => {
    const s = d.data(); const [par, contre] = await Promise.all([prenom(s.par), prenom(s.contre)]);
    return { id: d.id, conv: s.conv, bonCode: s.bonCode ?? null, motif: s.motif, bloquer: s.bloquer === true, le: date(s.le), par, contre };
  }));
  return {
    dossiers, signalements: sig.sort((a, b) => String(b.le).localeCompare(String(a.le))),
    avis: avis.docs.map((d) => { const a = d.data(); return { code: d.id, etalId: a.etalId, prenom: a.prenom, note: a.note, commentaire: a.commentaire, le: date(a.le) }; }),
    factures: factures.docs.map((d) => { const f = d.data(); return { numero: f.numero, bon: f.bon, emiseLe: f.emiseLe, acheteur: f.acheteur?.raison ?? '', vendeur: f.vendeur?.prenom ?? '', totalTtc: f.totalTtc }; }),
  };
});

// Décision sur un dossier pêcheur : vérifié (numéro de marin et immatriculation contrôlés), refusé ou suspendu
export const equipeDossier = onCall(APPEL, async (req) => {
  const { email } = await membreEquipe(req);
  const d = (req.data ?? {}) as { etalId?: string; decision?: string; motif?: string };
  const etalId = String(d.etalId ?? '');
  if (!/^[A-Za-z0-9]{1,40}$/.test(etalId) || !['verifier', 'refuser', 'suspendre'].includes(String(d.decision))) throw erreur('invalid-argument', 'Décision invalide.');
  const motif = normaliser(d.motif).slice(0, 300);
  if (d.decision !== 'verifier' && !motif) throw erreur('invalid-argument', 'Indiquez le motif : il est envoyé au pêcheur.');
  const ref = db.doc('etals/' + etalId);
  const e = (await ref.get()).data();
  if (!e?.pecheurId) throw erreur('not-found', 'Étal introuvable.');
  const dossier = ref.collection('verification').doc('dossier');
  const statut = d.decision === 'verifier' ? 'verifie' : d.decision === 'refuser' ? 'refuse' : 'suspendu';
  await db.runTransaction(async (t) => {
    t.set(dossier, d.decision === 'verifier'
      ? { numeroVerifie: true, verifiePar: email, verifieLe: FieldValue.serverTimestamp(), motifRefus: null }
      : { numeroVerifie: false, motifRefus: motif, decisionPar: email, decisionLe: FieldValue.serverTimestamp() }, { merge: true });
    // motif lisible par le pêcheur seulement (un étal non vérifié n'est pas public) ; droits mis à jour par etalModifie
    t.update(ref, { statut, motifStatut: statut === 'verifie' ? null : motif });
  });
  await journal(null, 'équipe : dossier ' + statut, { etalId, par: email, motif });
  await notifier([e.pecheurId], 'Votre dossier Pêche Connect',
    statut === 'verifie' ? 'Dossier vérifié : vous pouvez vendre dès que votre compte de paiement est prêt.' : 'Dossier ' + (statut === 'refuse' ? 'refusé' : 'suspendu') + ' : ' + motif);
  return { statut };
});

// Signalement : classé sans suite, ou compte de la personne signalée suspendu
export const equipeSignalement = onCall(APPEL, async (req) => {
  const { email } = await membreEquipe(req);
  const d = (req.data ?? {}) as { id?: string; decision?: string };
  const id = String(d.id ?? '');
  if (!/^[A-Za-z0-9]{1,40}$/.test(id) || !['classer', 'suspendre'].includes(String(d.decision))) throw erreur('invalid-argument', 'Décision invalide.');
  const ref = db.doc('signalements/' + id);
  const s = (await ref.get()).data();
  if (!s) throw erreur('not-found', 'Signalement introuvable.');
  if (s.traite) throw erreur('failed-precondition', 'Déjà traité.');
  if (d.decision === 'suspendre' && s.contre) {
    const etal = db.doc('etals/' + s.contre);
    if ((await etal.get()).exists) await etal.update({ statut: 'suspendu' }); // pêcheur : étal retiré de la vente
    else { await getAuth().updateUser(s.contre, { disabled: true }); await getAuth().revokeRefreshTokens(s.contre); } // client : compte bloqué
  }
  await ref.update({ traite: true, decision: d.decision, traitePar: email, traiteLe: FieldValue.serverTimestamp() });
  await journal(null, 'équipe : signalement ' + d.decision, { id, par: email, contre: s.contre });
  return { ok: true };
});

// Une facture archivée (PDF), pour la renvoyer à un pro ou au comptable
export const equipeFacture = onCall(APPEL, async (req) => {
  await membreEquipe(req);
  const numero = String((req.data as { numero?: string })?.numero ?? '');
  if (!/^FA-\d{4}-\d{6}$/.test(numero)) throw erreur('invalid-argument', 'Numéro invalide.');
  const f = getStorage().bucket().file('factures/' + numero + '.pdf');
  if (!(await f.exists())[0]) throw erreur('not-found', 'PDF pas encore archivé (refait automatiquement par les tâches).');
  const [contenu] = await f.download();
  return { nom: numero + '.pdf', pdf: contenu.toString('base64') };
});

// L'appli demande si ce compte fait partie de l'équipe (pour afficher le lien « Espace équipe »)
export const equipeAcces = onCall(APPEL, async (req) => {
  try { await membreEquipe(req); return { equipe: true }; } catch { return { equipe: false }; }
});
