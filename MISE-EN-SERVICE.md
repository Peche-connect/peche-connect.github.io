# Pêche Connect · mise en service (passer du mode démo au mode réel)

Tout le code est prêt : base de données, règles d'accès, paiement Stripe Connect, QR signé, notifications,
pages légales, suppression de compte. Ce qu'il reste demande **vos comptes** (Supabase, Stripe, Google, IONOS)
et, pour Stripe, **la société créée** (SIRET, compte bancaire pro). Comptez une demi-journée.

Tant que les étapes 1 et 7 ne sont pas faites, le site reste en **mode démo** (rien ne casse).

---

## 1. Base de données Supabase (15 min)

1. Créer un compte sur supabase.com, puis **New project** : nom `peche-connect`, région **West EU (Paris)**,
   mot de passe fort (à garder dans un gestionnaire de mots de passe).
2. **Database > Extensions** : activer `pg_cron` et `pg_net`.
3. **SQL Editor** : coller puis exécuter, dans l'ordre :
   - `app/supabase/migrations/20261117000000_schema.sql`
   - `app/supabase/migrations/20261117000100_photos_chauffeur_taches.sql`
   - `app/supabase/migrations/20261117000200_messages_vocaux.sql`
4. **Project Settings > API** : noter le *Project URL* et la clé *anon public* (publique, sans danger).
   La clé *service_role* est **secrète** : ne jamais la mettre dans l'appli ni sur GitHub.

> Plan gratuit : pas de sauvegarde automatique et projet mis en pause après 7 jours sans activité.
> **Au lancement, passer en Pro (25 $/mois)** : sauvegarde quotidienne gardée 7 jours. Tester une
> restauration une fois par trimestre (Database > Backups > restaurer dans un projet de test).

## 2. Connexion des utilisateurs (20 min)

**Authentication > URL Configuration** : *Site URL* = `https://peche-connect.github.io` ; *Redirect URLs* :
`https://peche-connect.github.io/**`, `https://peche-connect.fr/**`, `pecheconnect://**`.

**Google (gratuit, recommandé)** : sur console.cloud.google.com, créer un identifiant OAuth « Application Web »
avec l'URL de redirection `https://<votre-projet>.supabase.co/auth/v1/callback`, puis coller l'ID et le secret
dans **Authentication > Providers > Google**.

**SMS (facultatif, payant)** : seulement si vous voulez garder la connexion par numéro.
Créer un compte Twilio, puis **Authentication > Hooks > Send SMS hook** → fonction `envoi-sms`
(limite : 3 codes/heure et 6/jour par numéro, 2 000/jour au total). Ajouter `EXPO_PUBLIC_CONNEXION_SMS=1` à l'étape 7.

**Administration** : **Authentication > Multi-Factor** : activer TOTP (appli d'authentification).
Le compte administrateur n'a ses droits qu'une fois la double vérification faite.

## 3. Paiement Stripe Connect (30 min, société nécessaire)

1. Compte Stripe au nom de la société, puis **Connect** → modèle **Express** (Stripe gère l'identité et le RIB
   des pêcheurs).
2. **Developers > API keys** : noter la clé secrète `sk_live_…` (d'abord `sk_test_…` pour les essais).
3. **Developers > Webhooks > Add endpoint** : `https://<votre-projet>.supabase.co/functions/v1/stripe-webhook`
   - événements du compte : `checkout.session.completed`, `checkout.session.expired`, `payment_intent.canceled`
   - un 2e endpoint identique coché **« Connected accounts »** avec `account.updated`
   - noter les deux secrets de signature `whsec_…`

## 4. Secrets des fonctions serveur (5 min)

**Project Settings > Edge Functions > Secrets** (jamais dans le code) :

| Nom | Valeur |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` puis `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` du 1er endpoint |
| `STRIPE_WEBHOOK_SECRET_CONNECT` | `whsec_…` du 2e endpoint |
| `QR_SECRET` | une longue phrase aléatoire (40 caractères ou plus) |
| `CLE_TACHES` | une autre phrase aléatoire |
| `SITE_URL` | `https://peche-connect.github.io` (puis `https://peche-connect.fr`) |
| `ORIGINES_AUTORISEES` | `https://peche-connect.github.io,https://peche-connect.fr,https://www.peche-connect.fr` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `SEND_SMS_HOOK_SECRET` | seulement pour le SMS |

## 5. Déployer les fonctions serveur (5 min)

Sur un ordinateur avec Node.js : `cd app && npx supabase login && npx supabase link --project-ref <ref>`
puis `npx supabase functions deploy`. (Claude peut le faire si vous lui donnez un jeton d'accès Supabase
temporaire, à révoquer ensuite.)

## 6. Tâche « rappel de retrait » (2 min)

Dans le SQL Editor, en remplaçant `<ref>` et `<CLE_TACHES>` :

```sql
select cron.schedule('rappels-retrait', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/notifier',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cle-taches', '<CLE_TACHES>'),
    body := '{"type":"rappels"}'::jsonb)
$$);
```

## 7. Passer le site en mode réel

Donner à Claude le *Project URL* et la clé *anon public* (étape 1) : il reconstruit le site avec ces deux
valeurs (fichier `app/.env`, jamais envoyé sur GitHub ; voir `app/.env.example`) et le publie.

## 8. Premiers comptes

- **Vous (admin)** : se connecter une fois dans l'appli, puis SQL Editor :
  `update profils set role = 'admin' where id = (select id from auth.users where email = 'votre@email');`
  puis activer la double vérification.
- **Valider un pêcheur** : **Table Editor > etals** → `statut` = `verifie` (après contrôle de l'immatriculation).
  Il ouvre ensuite son compte de paiement Stripe depuis l'appli.
- **Montants** : **Table Editor > reglages** (frais de service, commission, marge, livraison, TVA).
- **Fermetures** : **Table Editor > fermetures** (lambi et langouste déjà saisis ; ajouter les zones chlordécone
  port par port).

## 9. Nom de domaine peche-connect.fr (IONOS → GitHub Pages)

1. IONOS > Domaines > `peche-connect.fr` > **DNS** : enregistrements **A** sur `@` vers
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` ; **CNAME** `www` → `peche-connect.github.io`.
2. Prévenir Claude : il ajoute le fichier `docs/CNAME`. Puis GitHub > Settings > Pages > *Custom domain*
   `peche-connect.fr` et **Enforce HTTPS** (après la propagation, jusqu'à 24 h).
3. Adresse mail : IONOS > Email > créer `contact@peche-connect.fr` (adresse citée dans les pages légales).

Si vous choisissez finalement Cloudflare pour héberger le site, le dossier `docs/` se publie tel quel sur
Cloudflare Pages ; les DNS se règlent alors chez Cloudflare au lieu de GitHub.

## 10. Sécurité du dépôt GitHub (2 min)

GitHub > Settings > **Code security** : activer *Dependabot alerts*, *Dependabot security updates* et
*Secret scanning / Push protection*. Le fichier `.github/dependabot.yml` est déjà en place, et les
vérifications automatiques (`.github/workflows/verifications.yml`) tournent à chaque envoi.

## 11. Surveillance

- **Database > Logs** et la table `journal` (webhooks rejetés, QR invalides, plafond de SMS atteint).
- La vue `activite_anormale` liste les comptes qui créent trop de bons ou de messages en une heure.
- En cas de fuite de données : prévenir la CNIL sous 72 h (cnil.fr, « Notifier une violation »).

## Avant d'ouvrir au public

Compléter les crochets […] des pages légales (`app/src/legal.ts`) une fois la société créée, désigner un
médiateur de la consommation, fixer les montants et les règles d'annulation, faire relire les textes.
