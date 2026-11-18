// Messagerie : tous les messages passent par le serveur, qui masque les numéros de téléphone AVANT
// de les enregistrer (anti-contournement), limite la cadence, contrôle les vocaux et les positions,
// et ferme la conversation 24 h après le retrait. Puis l'autre personne est prévenue.
import { getStorage } from 'firebase-admin/storage';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { APPEL, connecte, db, erreur, FieldValue, limiter, REGION, Timestamp } from './commun';
import { notifier } from './notifier';
import { masquerNumeros, normaliser } from './regles';

const AVERTISSEMENT = 'Numéro masqué : les échanges restent sur Pêche Connect jusqu’au retrait.';

export const envoyerMessage = onCall(APPEL, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'message', 30, 60); // 30 messages par minute au plus
  const d = (req.data ?? {}) as { conv?: string; texte?: string; audio?: { chemin?: string; duree?: number }; position?: { libelle?: string; lat?: number; lon?: number }; expireLe?: number };
  const convId = String(d.conv ?? '');
  if (!/^[A-Za-z0-9]{1,40}_[A-Za-z0-9]{1,40}$/.test(convId)) throw erreur('invalid-argument', 'Conversation introuvable.');
  const convRef = db.doc('conversations/' + convId);
  const conv = (await convRef.get()).data();
  if (!conv || !(conv.participants as string[]).includes(uid)) throw erreur('not-found', 'Conversation introuvable.');
  if (conv.fermeeLe && conv.fermeeLe.toMillis() < Date.now()) throw erreur('failed-precondition', 'Cette conversation est fermée (retrait terminé).');
  const auteur = uid === conv.pecheurId ? 'pecheur' : 'client';
  const m: Record<string, unknown> = { auteurId: uid, auteur, creeLe: FieldValue.serverTimestamp() };
  let masque = false;

  if (typeof d.texte === 'string' && d.texte.trim()) {
    const r = masquerNumeros(normaliser(d.texte).slice(0, 1000));
    m.texte = r.texte; masque = r.masque;
  } else if (d.audio) {
    const chemin = String(d.audio.chemin ?? '');
    const duree = Math.round(Number(d.audio.duree));
    if (!new RegExp('^' + convId + '/[A-Za-z0-9_.-]{1,60}$').test(chemin) || !(duree >= 1 && duree <= 120)) throw erreur('invalid-argument', 'Message vocal invalide.');
    const [existe] = await getStorage().bucket().file('messages-audio/' + chemin).exists();
    if (!existe) throw erreur('invalid-argument', 'Message vocal introuvable.');
    m.audio = { chemin, duree };
  } else if (d.position && auteur === 'pecheur') {
    const lat = Number(d.position.lat), lon = Number(d.position.lon);
    // la Martinique et ses abords seulement
    if (!(lat >= 14.3 && lat <= 15) || !(lon >= -61.4 && lon <= -60.7)) throw erreur('invalid-argument', 'Position hors de Martinique.');
    const expire = Math.min(Number(d.expireLe) || Date.now() + 30 * 60_000, Date.now() + 12 * 3600_000);
    if (!(expire > Date.now())) throw erreur('invalid-argument', 'Durée de partage invalide.');
    m.position = { libelle: masquerNumeros(normaliser(d.position.libelle).slice(0, 80)).texte || 'Position', lat, lon };
    m.positionExpireLe = Timestamp.fromMillis(expire);
  } else {
    throw erreur('invalid-argument', 'Message vide.');
  }
  await convRef.collection('messages').add(m);
  if (masque) await convRef.collection('messages').add({ auteurId: null, auteur: 'systeme', texte: AVERTISSEMENT, creeLe: FieldValue.serverTimestamp() });
  return { ok: true, masque };
});

// Après chaque message : conversation marquée « non lue » pour l'autre personne, notification
export const messageCree = onDocumentCreated({ region: REGION, document: 'conversations/{conv}/messages/{msg}' }, async (ev) => {
  const m = ev.data?.data();
  if (!m || m.auteur === 'systeme') return;
  const convRef = db.doc('conversations/' + ev.params.conv);
  const conv = (await convRef.get()).data();
  if (!conv) return;
  const versClient = m.auteur === 'pecheur';
  await convRef.update({ majLe: FieldValue.serverTimestamp(), ...(versClient ? { luClient: false } : { luPecheur: false }) });
  const etal = (await db.doc('etals/' + conv.etalId).get()).data();
  const qui = versClient ? (etal?.prenom ?? 'Le pêcheur') : conv.clientPrenom;
  const apercu = m.audio ? 'Message vocal' : m.position ? 'Position partagée' : String(m.texte ?? '').slice(0, 80);
  await notifier([versClient ? conv.clientId : conv.pecheurId], qui, apercu, { lien: versClient ? '/chat/' + conv.etalId + '|Vous' : '/conversation/' + conv.etalId + '|' + ev.params.conv });
});
