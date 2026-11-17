// Envoi du code de connexion par SMS (« Send SMS Hook » de Supabase Auth), avec une limite
// d'envois par numéro pour éviter les SMS facturés en masse par un robot :
//   3 codes par heure et 6 par jour pour un même numéro, 2 000 par jour au total.
// Fournisseur : Twilio (le plus simple) ; autre fournisseur = changer la fonction envoyer().
// Utile seulement si la connexion par SMS est activée (EXPO_PUBLIC_CONNEXION_SMS=1).
import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { admin, env } from '../_shared/outils.ts';

const LIMITE_HEURE = 3, LIMITE_JOUR = 6, LIMITE_GLOBALE_JOUR = 2000;

const refus = (message: string, statut = 429) =>
  new Response(JSON.stringify({ error: { http_code: statut, message } }), { status: statut, headers: { 'Content-Type': 'application/json' } });

async function envoyer(numero: string, texte: string) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(sid + ':' + env('TWILIO_AUTH_TOKEN')), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: numero, From: env('TWILIO_FROM'), Body: texte }),
  });
  if (!r.ok) throw new Error('Twilio ' + r.status + ' ' + await r.text());
}

Deno.serve(async (req) => {
  const corps = await req.text();
  let charge: { user: { phone: string }; sms: { otp: string } };
  try {
    const secret = env('SEND_SMS_HOOK_SECRET').replace('v1,whsec_', '');
    charge = new Webhook(secret).verify(corps, Object.fromEntries(req.headers)) as typeof charge;
  } catch {
    return refus('Requête non signée', 401);
  }
  const numero = '+' + charge.user.phone.replace(/^\+/, '');
  if (!/^\+(596|590|594|262|33)\d{9}$/.test(numero)) return refus('Numéro non pris en charge (Martinique, Antilles-Guyane, Réunion, France).', 400);

  const db = admin();
  const ilYa = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const [{ count: heure }, { count: jour }, { count: total }] = await Promise.all([
    db.from('envois_sms').select('*', { count: 'exact', head: true }).eq('telephone', numero).gt('cree_le', ilYa(1)),
    db.from('envois_sms').select('*', { count: 'exact', head: true }).eq('telephone', numero).gt('cree_le', ilYa(24)),
    db.from('envois_sms').select('*', { count: 'exact', head: true }).gt('cree_le', ilYa(24)),
  ]);
  if ((heure ?? 0) >= LIMITE_HEURE) return refus('Trop de codes demandés pour ce numéro. Réessayez dans une heure.');
  if ((jour ?? 0) >= LIMITE_JOUR) return refus('Trop de codes demandés aujourd’hui pour ce numéro. Réessayez demain.');
  if ((total ?? 0) >= LIMITE_GLOBALE_JOUR) {
    await db.from('journal').insert({ quoi: 'ALERTE : plafond quotidien de SMS atteint' });
    return refus('Service momentanément indisponible. Réessayez plus tard.', 503);
  }
  await db.from('envois_sms').insert({ telephone: numero });
  try {
    await envoyer(numero, 'Pêche Connect : votre code est ' + charge.sms.otp + '. Ne le donnez à personne.');
  } catch (e) {
    console.error(e);
    return refus('L’envoi du SMS a échoué. Réessayez.', 502);
  }
  return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
});
