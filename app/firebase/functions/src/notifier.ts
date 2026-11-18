// Notifications sur le téléphone (service Expo Push, gratuit, iPhone et Android).
// Sur le site web : pas de notification, les écrans se mettent à jour en direct.
import { db, FieldValue } from './commun';

export async function notifier(uids: string[], titre: string, texte: string, donnees: Record<string, string> = {}) {
  const ids = [...new Set(uids.filter(Boolean))];
  if (!ids.length || process.env.FUNCTIONS_EMULATOR === 'true') return 0;
  const profils = await Promise.all(ids.map((id) => db.doc('profils/' + id).get()));
  const envois = profils.flatMap((p) => ((p.data()?.jetons ?? []) as string[]).map((to) => ({ to, uid: p.id, title: titre, body: texte, data: donnees, sound: 'default' })));
  for (let i = 0; i < envois.length; i += 100) {
    const lot = envois.slice(i, i + 100);
    try {
      const envoyer = (l: typeof lot) => fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(l.map(({ uid: _u, ...m }) => m)),
      });
      let r = await envoyer(lot);
      // un jeton défaillant ne doit pas bloquer les autres : en cas de refus du lot, envoi un par un
      if (!r.ok && lot.length > 1) { for (const m of lot) await envoyer([m]).catch(() => null); continue; }
      const res = (await r.json()) as { data?: { details?: { error?: string } }[] };
      // jetons périmés (appli désinstallée) : retirés du profil
      await Promise.all((res.data ?? []).map((d, k) => d.details?.error === 'DeviceNotRegistered'
        ? db.doc('profils/' + lot[k].uid).update({ jetons: FieldValue.arrayRemove(lot[k].to) }) : null));
    } catch (e) { console.error('notification', e); }
  }
  return envois.length;
}
