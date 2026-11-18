// Appels par Internet entre le client et le pêcheur (Agora) : aucun numéro de téléphone n'est échangé.
// Le serveur délivre un jeton d'appel (valable 30 min) seulement aux deux personnes d'une conversation,
// qui n'existe qu'après une commande payée et se ferme 24 h après le retrait. L'autre personne est prévenue.
import { createHash } from 'node:crypto';
import { RtcRole, RtcTokenBuilder } from 'agora-token';
import { onCall } from 'firebase-functions/v2/https';
import { AGORA_APP_CERTIFICATE, AGORA_APP_ID, APPEL, connecte, db, erreur, FieldValue, limiter } from './commun';
import { notifier } from './notifier';

const DUREE = 30 * 60; // secondes

// Nom du « salon » d'appel : tiré de la conversation, impossible à deviner sans elle
export const canalAppel = (conv: string) => 'pc' + createHash('sha256').update('appel|' + conv).digest('hex').slice(0, 40);

export const jetonAppel = onCall({ ...APPEL, secrets: [AGORA_APP_CERTIFICATE] }, async (req) => {
  const uid = connecte(req);
  await limiter(uid, 'appel', 20);
  const d = (req.data ?? {}) as { conv?: string };
  const convId = String(d.conv ?? '');
  if (!/^[A-Za-z0-9]{1,40}_[A-Za-z0-9]{1,40}$/.test(convId)) throw erreur('invalid-argument', 'Conversation introuvable.');
  const ref = db.doc('conversations/' + convId);
  const conv = (await ref.get()).data();
  if (!conv || !(conv.participants as string[]).includes(uid)) throw erreur('not-found', 'Conversation introuvable.');
  if (conv.fermeeLe && conv.fermeeLe.toMillis() < Date.now()) throw erreur('failed-precondition', 'Cette conversation est fermée (retrait terminé).');
  const appId = AGORA_APP_ID.value(); const certificat = AGORA_APP_CERTIFICATE.value();
  if (!appId || !/^[0-9a-f]{32}$/i.test(certificat)) throw erreur('failed-precondition', 'Les appels ne sont pas encore activés. Écrivez un message en attendant.');
  const pecheur = uid === conv.pecheurId;
  const numero = pecheur ? 2 : 1; // 1 = client, 2 = pêcheur
  const canal = canalAppel(convId);
  const jeton = RtcTokenBuilder.buildTokenWithUid(appId, certificat, canal, numero, RtcRole.PUBLISHER, DUREE, DUREE);
  // l'autre a appelé il y a moins de 2 minutes : on répond (on ne fait pas sonner son téléphone en retour)
  const enCours = conv.appelEnCours as { par: string; le: FirebaseFirestore.Timestamp } | undefined;
  const reponse = !!enCours && enCours.par !== uid && enCours.le.toMillis() > Date.now() - 2 * 60_000;
  if (reponse) await ref.update({ appelEnCours: FieldValue.delete() });
  else {
    // l'autre personne est prévenue : ligne dans la conversation + notification sur son téléphone
    const etal = (await db.doc('etals/' + conv.etalId).get()).data();
    const qui = pecheur ? (etal?.prenom ?? 'Le pêcheur') : conv.clientPrenom;
    await ref.collection('messages').add({ auteurId: null, auteur: 'systeme', texte: qui + ' a lancé un appel. Touchez « Appeler » pour répondre.', appel: true, creeLe: FieldValue.serverTimestamp() });
    await ref.update({ appelEnCours: { par: uid, le: FieldValue.serverTimestamp() }, majLe: FieldValue.serverTimestamp(), ...(pecheur ? { luClient: false } : { luPecheur: false }) });
    await notifier([pecheur ? conv.clientId : conv.pecheurId], qui + ' vous appelle', 'Touchez pour répondre dans Pêche Connect.',
      { lien: pecheur ? '/appel/' + conv.etalId + '|Vous' : '/appel/' + conv.etalId + '|' + convId });
  }
  return { appId, canal, jeton, numero, autre: pecheur ? 1 : 2, expireDans: DUREE, reponse };
});
