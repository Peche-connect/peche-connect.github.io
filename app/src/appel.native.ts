// Appel par Internet dans l'appli installée (Agora, module natif react-native-agora)
import { PermissionsAndroid, Platform } from 'react-native';
import { ChannelProfileType, ClientRoleType, createAgoraRtcEngine, type IRtcEngine } from 'react-native-agora';
import type { Appel, ParamsAppel } from './appel';
export type { Appel, ParamsAppel } from './appel';

let moteur: IRtcEngine | null = null;

export async function demarrerAppel(p: ParamsAppel, surAutre: (present: boolean) => void): Promise<Appel> {
  if (Platform.OS === 'android') {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (r !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Autorisez le micro pour appeler.');
  }
  moteur?.release();
  const m = createAgoraRtcEngine(); moteur = m;
  m.initialize({ appId: p.appId, channelProfile: ChannelProfileType.ChannelProfileCommunication });
  m.registerEventHandler({
    onUserJoined: (_c, uid) => { if (uid === p.autre) surAutre(true); },
    onUserOffline: (_c, uid) => { if (uid === p.autre) surAutre(false); },
  });
  m.enableAudio(); m.disableVideo();
  m.setDefaultAudioRouteToSpeakerphone(false);
  const r = m.joinChannel(p.jeton, p.canal, p.numero, { clientRoleType: ClientRoleType.ClientRoleBroadcaster, publishMicrophoneTrack: true, autoSubscribeAudio: true });
  if (r < 0) { m.release(); moteur = null; throw new Error('L’appel n’a pas pu démarrer. Réessayez.'); }
  return {
    async raccrocher() { m.leaveChannel(); m.release(); if (moteur === m) moteur = null; },
    async micro(actif) { m.muteLocalAudioStream(!actif); },
    async hautParleur(actif) { m.setEnableSpeakerphone(actif); },
  };
}
