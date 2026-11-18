// Appel par Internet sur le site (Agora, dans le navigateur). Le SDK n'est chargé qu'au premier appel
// (fichier servi par le site lui-même : /vendor/agora-rtc-<version>.js), pour garder l'appli légère.
export type ParamsAppel = { appId: string; canal: string; jeton: string; numero: number; autre: number };
export type Appel = { raccrocher(): Promise<void>; micro(actif: boolean): Promise<void>; hautParleur(actif: boolean): Promise<void> };

const SDK = '/vendor/agora-rtc-4.24.10.js';
let chargement: Promise<any> | null = null;
function chargerSdk(): Promise<any> {
  const w = window as unknown as { AgoraRTC?: any };
  if (w.AgoraRTC) return Promise.resolve(w.AgoraRTC);
  chargement ??= new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = SDK; s.async = true;
    s.onload = () => (w.AgoraRTC ? ok(w.AgoraRTC) : ko(new Error('Appel indisponible.')));
    s.onerror = () => { chargement = null; ko(new Error('Appel indisponible : vérifiez votre connexion.')); };
    document.head.appendChild(s);
  });
  return chargement;
}

export async function demarrerAppel(p: ParamsAppel, surAutre: (present: boolean) => void): Promise<Appel> {
  const AgoraRTC = await chargerSdk();
  AgoraRTC.setLogLevel(3); // erreurs seulement
  const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  client.on('user-joined', (u: { uid: number }) => { if (u.uid === p.autre) surAutre(true); });
  client.on('user-left', (u: { uid: number }) => { if (u.uid === p.autre) surAutre(false); });
  client.on('user-published', async (u: any, type: string) => {
    if (type !== 'audio') return;
    await client.subscribe(u, type); u.audioTrack?.play();
  });
  let micro: any = null;
  try {
    await client.join(p.appId, p.canal, p.jeton, p.numero);
    micro = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
    await client.publish([micro]);
  } catch (e) {
    micro?.close(); await client.leave().catch(() => {});
    const nom = (e as { name?: string; code?: string })?.name ?? (e as { code?: string })?.code ?? '';
    throw new Error(/PERMISSION|NotAllowed/i.test(String(nom) + String(e)) ? 'Autorisez le micro pour appeler.' : 'L’appel n’a pas pu démarrer. Réessayez.');
  }
  return {
    async raccrocher() { micro?.close(); await client.leave().catch(() => {}); },
    async micro(actif) { await micro?.setEnabled(actif); },
    async hautParleur() { /* le navigateur choisit la sortie son */ },
  };
}
