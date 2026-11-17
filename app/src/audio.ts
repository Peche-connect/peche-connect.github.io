// Messages vocaux : enregistrement et lecture, sur le site (MediaRecorder du navigateur)
// et dans l'appli installée (expo-av). Durée limitée à 2 minutes.
import { Platform } from 'react-native';

export const DUREE_MAX_S = 120;
export type Enregistrement = { uri: string; type: string; duree: number; donnees?: Blob };

type Session = { arreter: () => Promise<Enregistrement | null>; annuler: () => void };

// Format accepté par le navigateur : Opus/WebM (Chrome, Android) ou MP4/AAC (Safari, iPhone)
function formatWeb() {
  const MR = (window as any).MediaRecorder;
  if (!MR) return null;
  // MP4/AAC d'abord : c'est le format que l'iPhone, Android et les ordinateurs savent tous relire
  for (const t of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) if (MR.isTypeSupported?.(t)) return t;
  return '';
}

export function enregistrementPossible() {
  if (Platform.OS !== 'web') return true;
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && formatWeb() !== null;
}

export async function demarrer(): Promise<Session> {
  const debut = Date.now();
  if (Platform.OS === 'web') {
    let flux: MediaStream;
    try { flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { throw new Error('Autorisez le micro pour envoyer un message vocal.'); }
    const type = formatWeb() || '';
    const rec = new (window as any).MediaRecorder(flux, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    const morceaux: Blob[] = [];
    rec.ondataavailable = (e: { data: Blob }) => { if (e.data?.size) morceaux.push(e.data); };
    rec.start(250);
    const fermer = () => flux.getTracks().forEach((t) => t.stop());
    return {
      arreter: () => new Promise((ok) => {
        rec.onstop = () => {
          fermer();
          const duree = Math.round((Date.now() - debut) / 1000);
          if (duree < 1 || !morceaux.length) { ok(null); return; }
          const blob = new Blob(morceaux, { type: rec.mimeType || type || 'audio/webm' });
          ok({ uri: URL.createObjectURL(blob), type: (blob.type || 'audio/webm').split(';')[0], duree, donnees: blob });
        };
        rec.stop();
      }),
      annuler: () => { try { rec.onstop = null; rec.stop(); } catch { /* déjà arrêté */ } fermer(); },
    };
  }
  const { Audio } = await import('expo-av');
  const p = await Audio.requestPermissionsAsync();
  if (!p.granted) throw new Error('Autorisez le micro dans les réglages du téléphone.');
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
  return {
    arreter: async () => {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      const duree = Math.round((Date.now() - debut) / 1000);
      return uri && duree >= 1 ? { uri, type: 'audio/mp4', duree } : null;
    },
    annuler: () => { recording.stopAndUnloadAsync().catch(() => {}); },
  };
}

// Transforme un enregistrement web en texte (data URL) pour le garder sur le téléphone en mode démo
export function versDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = ko; r.readAsDataURL(b); });
}

// Lecture : une seule note vocale à la fois
let enCours: { arreter: () => void } | null = null;
export async function lire(uri: string, finie: () => void): Promise<() => void> {
  enCours?.arreter();
  if (Platform.OS === 'web') {
    const a = new window.Audio(uri);
    const arreter = () => { a.pause(); finie(); };
    a.onended = finie; a.onerror = finie;
    await a.play().catch(() => finie());
    enCours = { arreter };
    return arreter;
  }
  const { Audio } = await import('expo-av');
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  sound.setOnPlaybackStatusUpdate((s) => { if ('didJustFinish' in s && s.didJustFinish) { sound.unloadAsync(); finie(); } });
  const arreter = () => { sound.stopAsync().then(() => sound.unloadAsync()).catch(() => {}); finie(); };
  enCours = { arreter };
  return arreter;
}

export const duree = (s: number) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
