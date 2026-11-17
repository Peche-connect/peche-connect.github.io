// Coupe-circuit de facture. Firebase n'a pas de plafond automatique : un budget Google Cloud « Plafond
// Pêche Connect » publie ses alertes sur le sujet Pub/Sub « alertes-budget » ; dès que la dépense du mois
// atteint ce plafond, cette fonction coupe la facturation du projet (le site s'arrête, mais la facture aussi).
// On relance à la main dans la console (Facturation > Associer un compte) après avoir compris la cause.
import { logger } from 'firebase-functions';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { GoogleAuth } from 'google-auth-library';
import { journal, REGION } from './commun';

export type AlerteBudget = { costAmount?: number; budgetAmount?: number; budgetDisplayName?: string };
// Décision testée à part : couper seulement si le budget visé est le plafond et qu'il est atteint
export const doitCouper = (a: AlerteBudget) =>
  /plafond/i.test(a.budgetDisplayName ?? '') && typeof a.costAmount === 'number' && typeof a.budgetAmount === 'number' && a.budgetAmount > 0 && a.costAmount >= a.budgetAmount;

export const coupeCircuit = onMessagePublished({ region: REGION, topic: 'alertes-budget' }, async (ev) => {
  const a = ev.data.message.json as AlerteBudget;
  if (!doitCouper(a)) return;
  const projet = process.env.GCLOUD_PROJECT;
  logger.error('ALERTE_SECURITE coupe-circuit : plafond de dépense atteint, facturation coupée', { ...a, projet });
  await journal(null, 'ALERTE : plafond de dépense atteint, facturation coupée', a);
  if (process.env.FUNCTIONS_EMULATOR === 'true') return;
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-billing'] }).getClient();
  await client.request({ url: `https://cloudbilling.googleapis.com/v1/projects/${projet}/billingInfo`, method: 'PUT', data: { billingAccountName: '' } });
});
