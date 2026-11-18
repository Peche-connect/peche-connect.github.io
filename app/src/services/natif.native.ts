// Appli installée (iPhone, Android) : connexion Google et Apple avec les fenêtres natives du téléphone.
// Le jeton obtenu est ensuite donné à Firebase (backend.ts), qui crée ou retrouve le compte.
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

class Annule extends Error { code = 'auth/popup-closed-by-user'; }
let configure = false;

export async function jetonGoogle(): Promise<string> {
  if (!configure) {
    // identifiants « client OAuth » créés dans la console Google Cloud du projet Firebase (MISE-EN-SERVICE.md)
    GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID });
    configure = true;
  }
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const r = await GoogleSignin.signIn();
    if (r.type !== 'success' || !r.data.idToken) throw new Annule('Connexion annulée.');
    return r.data.idToken;
  } catch (e) {
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) throw new Annule('Connexion annulée.');
    throw e;
  }
}

// « Se connecter avec Apple » : seulement sur iPhone (obligatoire sur l'App Store dès qu'on propose Google)
export async function appleDisponible() {
  return Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync());
}
export async function jetonApple(): Promise<{ idToken: string; nonce: string; prenom?: string }> {
  // nonce : nombre à usage unique, haché pour Apple, en clair pour Firebase (empêche le rejeu du jeton)
  const nonce = Crypto.randomUUID();
  const hache = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const c = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce: hache,
    });
    if (!c.identityToken) throw new Annule('Connexion annulée.');
    return { idToken: c.identityToken, nonce, prenom: c.fullName?.givenName ?? undefined };
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new Annule('Connexion annulée.');
    throw e;
  }
}

export async function deconnexionNative() {
  try { await GoogleSignin.signOut(); } catch { /* pas connecté avec Google */ }
}
