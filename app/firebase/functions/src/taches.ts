// Tâches automatiques (toutes les 5 minutes, une seule tâche planifiée pour rester dans la gratuité) :
// positions de pêcheur expirées effacées, paiements abandonnés remis en vente, rappels de retrait.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, REGION, Timestamp } from './commun';
import { notifier } from './notifier';
import { annulerBon } from './reservations';
import { champsSiret, verifierSiret } from './sirene';
import { archiverPdf, emettreFacture } from './factures';

export async function lancerTaches(maintenant = Date.now()) {
  const bilan = { positions: 0, abandons: 0, rappels: 0, sirets: 0, factures: 0 };
  // 1. positions expirées
  const pos = await db.collectionGroup('messages').where('positionExpireLe', '<', Timestamp.fromMillis(maintenant)).limit(300).get();
  for (const m of pos.docs) {
    await m.ref.update({ position: FieldValue.delete(), positionExpireLe: FieldValue.delete(), texte: 'Position partagée (expirée)' });
    bilan.positions++;
  }
  // 2. paiements abandonnés : 1 h pour une réservation, 24 h pour une commande de pro
  const attente = await db.collection('bons').where('statut', '==', 'en_attente_paiement').where('creeLe', '<', Timestamp.fromMillis(maintenant - 3600_000)).limit(200).get();
  for (const b of attente.docs) {
    const x = b.data();
    if (x.origine === 'demande' && x.creeLe.toMillis() > maintenant - 24 * 3600_000) continue;
    // jamais pendant qu'une page de paiement est encore ouverte (sinon le client paierait un bon annulé)
    const exp = (await db.doc('bonsSecrets/' + b.id).get()).data()?.sessionExpireLe;
    if (exp && exp.toMillis() > maintenant) continue;
    await annulerBon(b.id, 'paiement non effectué dans le délai');
    bilan.abandons++;
  }
  // 3. rappel de retrait, une seule fois, 1 h après le paiement
  const rappels = await db.collection('bons').where('statut', '==', 'reserve').where('rappelEnvoye', '==', false).where('payeLe', '<', Timestamp.fromMillis(maintenant - 3600_000)).limit(200).get();
  for (const b of rappels.docs) {
    const x = b.data();
    const etal = (await db.doc('etals/' + x.etalId).get()).data();
    await notifier([x.clientId], 'Votre poisson vous attend', 'Bon ' + x.code + ' chez ' + (etal?.prenom ?? 'votre pêcheur') + ' (' + (etal?.port ?? '') + ') · ' + x.creneau, { lien: '/bon/' + x.code });
    await b.ref.update({ rappelEnvoye: true });
    bilan.rappels++;
  }
  // 4. SIRET pas encore confirmés (répertoire injoignable ou établissement tout juste créé) : nouvel essai toutes les 6 h
  const pros = await db.collection('pros').where('siretVerifie', '==', false).limit(50).get();
  for (const p of pros.docs) {
    const x = p.data();
    if (x.siretStatut === 'ferme' || (x.siretControleLe?.toMillis?.() ?? 0) > maintenant - 6 * 3600_000 || bilan.sirets >= 10) continue;
    const v = await verifierSiret(String(x.siret));
    if (v.statut !== 'indisponible') { await p.ref.update(champsSiret(v)); bilan.sirets++; }
  }
  // 5. factures des pros pas encore émises ou PDF pas encore archivé (erreur passagère) : nouvel essai
  const sansFacture = await db.collection('bons').where('statut', '==', 'retire').where('facture', '==', null).limit(20).get();
  for (const b of sansFacture.docs) if (b.data().pro && (await emettreFacture(b.id).catch(() => null))) bilan.factures++;
  const sansPdf = await db.collection('factures').where('pdf', '==', false).limit(20).get();
  for (const f of sansPdf.docs) await archiverPdf(f.id).catch(() => null);
  return bilan;
}

export const taches = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeZone: 'America/Martinique' }, async () => {
  const b = await lancerTaches();
  if (b.positions || b.abandons || b.rappels) console.log('tâches', b);
});
