// À chaque nouveau message : numéros de téléphone masqués (anti-contournement), conversation marquée
// « non lue » pour l'autre personne, notification sur son téléphone.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, FieldValue, REGION } from './commun';
import { notifier } from './notifier';
import { masquerNumeros } from './regles';

export const messageCree = onDocumentCreated({ region: REGION, document: 'conversations/{conv}/messages/{msg}' }, async (ev) => {
  const m = ev.data?.data();
  if (!m || m.auteur === 'systeme') return;
  const convRef = db.doc('conversations/' + ev.params.conv);
  if (typeof m.texte === 'string') {
    const r = masquerNumeros(m.texte);
    if (r.masque) {
      await ev.data!.ref.update({ texte: r.texte });
      await convRef.collection('messages').add({ auteurId: null, auteur: 'systeme', texte: 'Numéro masqué : les échanges restent sur Pêche Connect jusqu’au retrait.', creeLe: FieldValue.serverTimestamp() });
    }
  }
  const conv = (await convRef.get()).data();
  if (!conv) return;
  const versClient = m.auteur === 'pecheur';
  await convRef.update({ majLe: FieldValue.serverTimestamp(), ...(versClient ? { luClient: false } : { luPecheur: false }) });
  const etal = (await db.doc('etals/' + conv.etalId).get()).data();
  const qui = versClient ? (etal?.prenom ?? 'Le pêcheur') : conv.clientPrenom;
  const apercu = m.audio ? 'Message vocal' : m.position ? 'Position partagée' : masquerNumeros(String(m.texte ?? '')).texte.slice(0, 80);
  await notifier([versClient ? conv.clientId : conv.pecheurId], qui, apercu, { lien: versClient ? '/chat/' + conv.etalId + '|Vous' : '/conversation/' + conv.etalId + '|' + ev.params.conv });
});
