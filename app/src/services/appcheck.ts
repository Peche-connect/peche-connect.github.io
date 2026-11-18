// Anti-robots (App Check) sur le site : reCAPTCHA Enterprise invisible
import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

export function activerAppCheck(app: FirebaseApp) {
  const cle = process.env.EXPO_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (cle) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(cle), isTokenAutoRefreshEnabled: true });
}
