// À chaque nouveau message : numéros de téléphone masqués (anti-contournement), conversation marquée
// « non lue » pour l'autre personne, notification sur son téléphone.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, FieldValue, journal, REGION, Timestamp } from './commun';
import { notifier } from './notifier';
import { masquerNumeros } from './regles';

export const messageCree = onDocumentCreated({ region: REGION, document: 'conversations/{conv}/messages/{msg}' }, async (ev) => {
  const m = ev.data?.data();
  if (!m || m.auteur === 'systeme') return;
  const convRef = db.doc('conversations/' + ev.params.conv);
  // anti-abus : plus de 20 messages en une minute dans une conversation = message supprimé et signalé
  const recents = await convRef.collection('messages').where('auteurId', '==', m.auteurId).where('creeLe', '>', Timestamp.fromMillis(Date.now() - 60_000)).count().get();
  if (recents.data().count > 20) {
    await ev.data!.ref.delete();
    await journal(m.auteurId, 'messages en rafale bloqués', { conversation: ev.params.conv });
    return;
  }
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

// Besoins des pros : au plus 10 ouverts à la fois par professionnel (contre les abus)
export const demandeCreee = onDocumentCreated({ region: REGION, document: 'demandes/{id}' }, async (ev) => {
  const d = ev.data?.data();
  if (!d?.proId) return;
  const ouvertes = await db.collection('demandes').where('proId', '==', d.proId).where('statut', '==', 'ouverte').count().get();
  if (ouvertes.data().count > 10) {
    await ev.data!.ref.update({ statut: 'annulee' });
    await journal(d.proId, 'trop de besoins ouverts : besoin annulé', { id: ev.params.id });
  }
});
