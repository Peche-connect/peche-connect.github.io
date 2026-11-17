// Notifications sur le téléphone (service Expo Push : gratuit, fonctionne pour iPhone et Android).
// Sur le site web, pas de notification : les écrans se mettent à jour en temps réel.
import { admin } from './outils.ts';

export async function notifier(profils: string[], titre: string, texte: string, donnees: Record<string, string> = {}) {
  if (!profils.length) return 0;
  const { data } = await admin().from('jetons_push').select('jeton').in('profil_id', profils);
  const messages = (data ?? []).map((j) => ({ to: j.jeton, title: titre, body: texte, data: donnees, sound: 'default' }));
  for (let i = 0; i < messages.length; i += 100) {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    const res = await r.json().catch(() => null) as { data?: { status: string; details?: { error?: string } }[] } | null;
    // jetons périmés (appli désinstallée) : on les supprime
    const morts = (res?.data ?? []).map((d, k) => (d.details?.error === 'DeviceNotRegistered' ? messages[i + k].to : null)).filter(Boolean) as string[];
    if (morts.length) await admin().from('jetons_push').delete().in('jeton', morts);
  }
  return messages.length;
}
