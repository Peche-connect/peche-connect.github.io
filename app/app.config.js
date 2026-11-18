// Configuration de l'appli installée (iPhone, Android), en plus de app.json.
// Les identifiants qui n'existent pas encore (Google, Firebase, Apple) sont lus dans .env le jour J :
// tant qu'ils manquent, les modules correspondants ne sont simplement pas ajoutés.
const fs = require('fs');
const path = require('path');

const existe = (f) => fs.existsSync(path.join(__dirname, f));
const ANDROID_FIREBASE = 'firebase-natif/google-services.json';
const IOS_FIREBASE = 'firebase-natif/GoogleService-Info.plist';
const firebaseNatif = existe(ANDROID_FIREBASE) && existe(IOS_FIREBASE);
// « com.googleusercontent.apps.xxxx » : l'identifiant client iOS de Google, à l'envers
const schemaGoogleIos = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
  ? 'com.googleusercontent.apps.' + process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.replace('.apps.googleusercontent.com', '') : null;
const domaine = (process.env.EXPO_PUBLIC_SITE_URL || 'https://peche-connect.fr').replace(/^https?:\/\//, '').replace(/\/$/, '');

module.exports = ({ config }) => ({
  ...config,
  version: '1.0.0',
  owner: process.env.EXPO_OWNER || undefined,
  runtimeVersion: { policy: 'appVersion' },
  extra: { ...(config.extra || {}), eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined } },
  ios: {
    ...config.ios,
    buildNumber: '1',
    usesAppleSignIn: true,
    associatedDomains: ['applinks:' + domaine],
    ...(firebaseNatif ? { googleServicesFile: './' + IOS_FIREBASE } : {}),
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: 'Pour photographier votre pêche avant de la mettre en vente.',
      NSPhotoLibraryUsageDescription: 'Pour choisir la photo de votre pêche.',
      NSMicrophoneUsageDescription: 'Pour envoyer des messages vocaux et appeler le pêcheur ou le client.',
      NSLocationWhenInUseUsageDescription: 'Pour partager votre position avec vos clients du jour, seulement quand vous le demandez.',
      UIBackgroundModes: ['audio'],
    },
  },
  android: {
    ...config.android,
    versionCode: 1,
    ...(firebaseNatif ? { googleServicesFile: './' + ANDROID_FIREBASE } : {}),
    permissions: ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'POST_NOTIFICATIONS', 'MODIFY_AUDIO_SETTINGS', 'BLUETOOTH_CONNECT'],
    blockedPermissions: ['android.permission.READ_PHONE_STATE', 'android.permission.ACCESS_BACKGROUND_LOCATION'],
    intentFilters: [{
      action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'],
      data: ['/bon', '/pesee', '/connexion', '/appel'].map((pathPrefix) => ({ scheme: 'https', host: domaine, pathPrefix })),
    }],
  },
  plugins: [
    ...(config.plugins || []),
    'expo-apple-authentication',
    ['expo-image-picker', { photosPermission: 'Pour choisir la photo de votre pêche.', cameraPermission: 'Pour photographier votre pêche avant de la mettre en vente.' }],
    ['expo-location', { locationWhenInUsePermission: 'Pour partager votre position avec vos clients du jour, seulement quand vous le demandez.' }],
    ['expo-av', { microphonePermission: 'Pour envoyer des messages vocaux et appeler le pêcheur ou le client.' }],
    ['expo-notifications', { color: '#12355b' }],
    ...(schemaGoogleIos ? [['@react-native-google-signin/google-signin', { iosUrlScheme: schemaGoogleIos }]] : []),
    ...(firebaseNatif ? ['@react-native-firebase/app', '@react-native-firebase/app-check'] : []),
    ['expo-build-properties', { ios: { useFrameworks: 'static', deploymentTarget: '15.1' }, android: { minSdkVersion: 24 } }],
  ],
});
