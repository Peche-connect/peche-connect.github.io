// QR code du bon : lien signé (HMAC-SHA256) impossible à fabriquer sans la clé QR_SECRET.
// Le pêcheur le scanne avec l'appareil photo : il ouvre /pesee/<code>?s=<signature>,
// et la fonction « verifier-bon » contrôle la signature avant la pesée.
import { env } from './outils.ts';

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function cle() {
  return crypto.subtle.importKey('raw', enc.encode(env('QR_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function signerBon(code: string, bonId: string) {
  const sig = await crypto.subtle.sign('HMAC', await cle(), enc.encode(code + '|' + bonId));
  return b64url(sig).slice(0, 22); // 132 bits : largement suffisant, QR plus lisible
}

// Comparaison à temps constant
export async function signatureValide(code: string, bonId: string, signature: string) {
  const attendue = await signerBon(code, bonId);
  if (attendue.length !== signature.length) return false;
  let d = 0;
  for (let i = 0; i < attendue.length; i++) d |= attendue.charCodeAt(i) ^ signature.charCodeAt(i);
  return d === 0;
}
