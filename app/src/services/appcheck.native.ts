// Anti-robots (App Check) dans l'appli installée : App Attest sur iPhone, Play Integrity sur Android.
// Le jeton est fabriqué par le module natif @react-native-firebase/app-check, puis transmis au SDK Firebase
// web utilisé par le reste de l'appli. Sans les fichiers de configuration Firebase (google-services.json,
// GoogleService-Info.plist), le module natif est absent : l'appli fonctionne, mais le serveur refusera ses appels.
import type { FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck } from 'firebase/app-check';

export function activerAppCheck(app: FirebaseApp) {
  let natif: any;
  try { natif = require('@react-native-firebase/app-check').default; } catch { return; }
  try {
    const fournisseur = natif().newReactNativeFirebaseAppCheckProvider();
    fournisseur.configure({
      android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
      apple: { provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback' },
    });
    natif().initializeAppCheck({ provider: fournisseur, isTokenAutoRefreshEnabled: true });
    initializeAppCheck(app, {
      isTokenAutoRefreshEnabled: true,
      provider: new CustomProvider({
        getToken: async () => {
          const { token } = await natif().getToken();
          return { token, expireTimeMillis: Date.now() + 30 * 60_000 };
        },
      }),
    });
  } catch { /* configuration Firebase native absente : voir MISE-EN-SERVICE.md */ }
}
