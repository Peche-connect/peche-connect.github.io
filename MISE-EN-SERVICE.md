# Pêche Connect · mise en service (le jour où la société a sa carte bancaire)

Tout est prêt dans le code et testé automatiquement à chaque envoi sur GitHub (91 tests serveur et un
parcours complet client / pêcheur dans un vrai navigateur). Il ne reste qu'à **créer les comptes au nom
de la société** et à brancher. Tant que ce n'est pas fait, le site reste en **mode démo** (rien ne casse).

Choix retenus : site sur **Cloudflare Pages**, serveur sur **Firebase** (Paris), paiement **Stripe Connect**,
connexion **Google, Apple ou lien e-mail** (gratuits, plus de SMS), mails **Zoho** sur peche-connect.fr.

Ce qu'il faut avant de commencer : le Kbis, le compte bancaire pro et sa carte, une adresse Gmail de la
société (ex. pecheconnect.martinique@gmail.com) avec la **validation en deux étapes activée**.

---

## 1. Firebase (20 min)

1. console.firebase.google.com avec le Gmail de la société → **Ajouter un projet** → nom `peche-connect`
   (Google Analytics : non).
2. **Passer au forfait Blaze** (paiement à l'usage) avec la carte de la société. C'est obligatoire pour
   les fonctions serveur et les fichiers, mais on reste dans la partie gratuite. **Créer tout de suite une
   alerte de budget à 10 €** (Google Cloud > Facturation > Budgets et alertes).
3. **Firestore Database** → Créer → mode production → emplacement **europe-west9 (Paris)**.
4. **Storage** → Commencer → même emplacement.
5. **Authentication** → Commencer → Méthodes de connexion : activer **Google** et **Adresse e-mail /
   Lien par e-mail (connexion sans mot de passe)**. Apple plus tard (compte Apple Developer, 99 $/an).
   Paramètres > Domaines autorisés : ajouter `peche-connect.fr` et l'adresse Cloudflare (`peche-connect.pages.dev`).
6. **Paramètres du projet > Vos applications > Web (</>)** : nom « Pêche Connect », puis copier la
   configuration (apiKey, appId…) : elle va à Claude à l'étape 4.
7. **App Check** (anti-robots) → application Web → fournisseur **reCAPTCHA Enterprise** → créer la clé de
   site pour `peche-connect.fr` → la noter pour Claude. Puis, **une fois le site en ligne et testé**, activer
   l'**application** (Enforce) pour Firestore, Storage et Authentication. Les fonctions serveur l'exigent déjà.
8. **Authentication > Paramètres** : activer la **protection contre l'énumération des adresses e-mail**.
9. **Utilisateurs et autorisations** : ajouter Louis comme second **propriétaire**, chacun avec la
   validation en deux étapes (idéalement une clé de sécurité physique), pour ne jamais être bloqués.

## 2. Stripe (30 min)

1. Compte Stripe au nom de la société (Kbis, IBAN pro), puis **Connect** → comptes **Express**.
2. Clé secrète : **Développeurs > Clés API** (`sk_test_…` pour les essais, puis `sk_live_…`).
3. **Développeurs > Webhooks** → endpoint `https://europe-west9-peche-connect.cloudfunctions.net/stripeWebhook`,
   événements `checkout.session.completed`, `checkout.session.expired`, `payment_intent.canceled` ;
   un 2e endpoint identique coché **« Comptes connectés »** avec `account.updated`. Noter les deux `whsec_…`.

## 3. Envoyer le serveur sur Firebase

Le plus simple : donner à Claude un accès temporaire (il fait tout, puis vous le retirez). Sinon, sur un
ordinateur avec Node.js, depuis `app/firebase` :

```
npx firebase-tools login
npx firebase-tools use peche-connect
npx firebase-tools functions:secrets:set STRIPE_SECRET_KEY              # sk_test_… puis sk_live_…
npx firebase-tools functions:secrets:set STRIPE_WEBHOOK_SECRET          # whsec_… du 1er endpoint
npx firebase-tools functions:secrets:set STRIPE_WEBHOOK_SECRET_CONNECT  # whsec_… du 2e
npx firebase-tools functions:secrets:set QR_SECRET                      # une longue phrase au hasard
npx firebase-tools functions:secrets:set AGORA_APP_CERTIFICATE          # certificat Agora (section 11), ou « - » en attendant
npx firebase-tools deploy
```

`deploy` envoie les règles d'accès (`firestore.rules`, `storage.rules`), les index et les fonctions.

## 4. Brancher l'appli

Donner à Claude la configuration Web (étape 1.6). Il la met dans `app/.env` (jamais envoyé sur GitHub),
reconstruit le site en mode réel et le publie.

## 5. Site sur Cloudflare Pages + nom de domaine (20 min)

1. dash.cloudflare.com (compte de la société) → **Workers & Pages > Créer > Pages > Connecter à Git** →
   dépôt `Peche-connect/peche-connect.github.io`, branche `main`, **commande de build : aucune**,
   **dossier de sortie : `docs`**. Les fichiers `_headers` (sécurité) et `_redirects` (liens de l'appli) sont prêts.
2. **Ajouter un domaine personnalisé** `peche-connect.fr` : Cloudflare indique les deux serveurs DNS à
   mettre chez IONOS (Domaines > peche-connect.fr > Serveurs de noms). La gestion DNS passe chez Cloudflare.
3. Une fois le site ouvert sur peche-connect.fr : **passer le dépôt GitHub en privé** (GitHub Pages
   n'autorise pas un site qui sert à vendre ; il ne sert plus que de copie de secours).

## 6. Mails sur le domaine (Zoho, gratuit)

zoho.com/mail → offre gratuite → domaine `peche-connect.fr` → ajouter dans Cloudflare (DNS) les
enregistrements MX, SPF et DKIM que Zoho affiche → créer `contact@peche-connect.fr` (cité dans les pages légales).

## 7. Premiers pêcheurs

- Un pêcheur s'inscrit dans l'appli (rôle « Pêcheur ») : son étal apparaît dans **Firestore > etals**
  avec `statut = en_attente`. Après contrôle de son immatriculation : mettre `statut` à **`verifie`**.
- Il ouvre ensuite son compte de paiement Stripe depuis l'appli ; Stripe prévient le serveur quand c'est prêt.
- Montants : **Firestore > reglages > general** (créer le document si besoin : `fraisService`,
  `commissionPct`, `margeEmpreinte`, `livraisonMinKg`, `fraisLivraison`). Sans document : 0,90 € de frais,
  0 % de commission, marge de 10 %, livraison 15 € dès 10 kg.
- Fermetures : lambi et langouste déjà bloqués ; zones chlordécone dans **Firestore > fermetures**
  (`espece`, `debut` « MM-JJ », `fin`, `motif`, `port`).

## 8. Coupe-circuit de facture (10 min, indispensable)

Firebase n'a pas de plafond automatique : un robot ou une erreur pourrait faire grimper la facture.
1. Google Cloud > **Facturation > Budgets et alertes** : budget « Alerte » à **10 €/mois** (e-mails à 50, 90, 100 %).
2. Second budget nommé exactement **« Plafond Pêche Connect »** à **50 €/mois** → *Gérer les notifications* →
   **Associer un sujet Pub/Sub** : créer le sujet `alertes-budget`.
3. **IAM** : donner au compte de service des fonctions (`<numéro>-compute@developer.gserviceaccount.com`) le
   rôle **Gestionnaire de facturation du projet**. La fonction `coupeCircuit` coupe alors la facturation dès
   que le plafond est atteint (le site s'arrête, la facture aussi ; on relance à la main après analyse).

## 9. Surveillance et sauvegardes

- **Alerte sécurité par e-mail** : Google Cloud > Logging > *Créer une alerte basée sur les journaux*,
  requête `textPayload:"ALERTE_SECURITE" OR jsonPayload.message:"ALERTE_SECURITE"`, notification par
  e-mail aux deux associés. Elle se déclenche sur : faux paiement Stripe rejeté, faux QR, messages en rafale,
  robot qui insiste, plafond de dépense atteint.
- **Alerte erreurs** : même chose avec `severity>=ERROR` sur les fonctions (`resource.type="cloud_run_revision"`).
- **Sauvegarde quotidienne de la base** (gardée 7 jours), une commande dans Google Cloud Shell :
  `gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d`
- **Restauration** (à tester une fois par trimestre, dans une base à part, sans toucher à la vraie) :
  `gcloud firestore backups list` puis
  `gcloud firestore databases restore --source-backup=<nom de la sauvegarde> --destination-database=restauration-test`
- Fichiers (photos, vocaux) : la suppression douce de Cloud Storage garde les fichiers effacés 7 jours.
- **Journal** des événements de sécurité : collection `journal` (webhooks rejetés, faux QR, inscriptions à vérifier).
- Validation en deux étapes sur **tous** les comptes (Gmail, Firebase, Stripe, Cloudflare, GitHub, Zoho, IONOS).
- GitHub > Settings > Code security : *Dependabot alerts* et *Secret scanning* activés.
- En cas de fuite de données : prévenir la CNIL sous 72 h.

## 10. Appli iPhone et Android : publication sur l'App Store et Google Play

Tout est prêt dans le dépôt : configuration (`app/app.config.js`, `app/eas.json`), connexion Google et Apple
natives, anti-robots natif, textes des fiches, captures et visuels (`magasins/`). Il reste les comptes.

**Comptes (au nom de la SARL)**
1. **Numéro D-U-N-S** de la société (gratuit, demandé par Apple et Google pour un compte d'entreprise ;
   jusqu'à un mois d'attente) : à demander dès que le Kbis est reçu.
2. **Apple Developer Program**, compte « Organisation » : 99 $ par an. Noter l'identifiant d'équipe (Team ID).
3. **Google Play Console**, compte « Organisation » : 25 $ une fois.
4. **Expo** (expo.dev), compte de la société, gratuit : fabrique les applis dans le cloud (EAS).

**Firebase et Google**
5. Console Firebase > Paramètres du projet > Ajouter une application **iOS** puis **Android**, identifiant
   `fr.pecheconnect.app` : télécharger `GoogleService-Info.plist` et `google-services.json`, les déposer dans
   `app/firebase-natif/`. Console Firebase > App Check : activer **App Attest** (iOS) et **Play Integrity** (Android).
6. Console Google Cloud > Identifiants : relever l'identifiant du **client Web** (créé par Firebase) et créer un
   client **iOS** (bundle `fr.pecheconnect.app`) → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` et
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` dans `app/.env`. Pour Android, ajouter l'empreinte SHA-1 de la clé de
   signature (donnée par `eas credentials`) à l'application Android dans Firebase.
7. Console Firebase > Authentication > Apple : activer avec l'identifiant de service et la clé créés sur
   developer.apple.com (Sign in with Apple).

**Fabriquer et envoyer** (Claude peut le faire avec un accès au compte Expo)
```
cd app
npx eas-cli login
npx eas-cli init                      # crée le projet Expo → EXPO_PUBLIC_EAS_PROJECT_ID dans .env
npx eas-cli build --profile test --platform android     # appli d'essai à installer sur vos téléphones
npx eas-cli build --profile production --platform all   # versions pour les magasins
npx eas-cli submit --profile production --platform all  # envoi à Apple et Google
```
8. Remplacer dans `app/public/.well-known/` : `EQUIPE_APPLE` par le Team ID, et l'empreinte SHA-256 par
   celle de la clé de Google Play (Play Console > Intégrité de l'appli) : les liens du site (bons, pesée)
   ouvriront alors directement l'appli.
9. Remplir les fiches avec `magasins/FICHES.md` (textes, confidentialité, notes pour la vérification) et
   les images de `magasins/`. Joindre la vidéo de démonstration pour Apple.
10. Apple et Google vérifient l'appli (en général quelques jours). Le test fermé obligatoire de Google
    (12 testeurs pendant 14 jours) ne concerne que les comptes personnels : avec un compte d'organisation
    (SARL + D-U-N-S), publication directe.

Pour essayer l'appli sur un téléphone avant les magasins : `eas build --profile developpement` (Expo Go ne suffit
plus, l'appli contient des modules natifs : connexion Apple / Google, appels).

## 11. Appels par Internet (Agora)

1. Créer un compte sur agora.io (offre gratuite : un quota de minutes offert chaque mois), puis un projet
   « Secured mode: APP ID + Token ».
2. Relever l'**App ID** → `AGORA_APP_ID=…` dans `app/firebase/functions/.env`, et le **certificat principal**
   → `functions:secrets:set AGORA_APP_CERTIFICATE`. Redéployer les fonctions.
3. Sans ces réglages, le bouton « Appeler » affiche « Les appels ne sont pas encore activés » : rien ne casse.

## Avant d'ouvrir au public

- Compléter les crochets […] des pages légales (`app/src/legal.ts`), désigner un médiateur de la
  consommation, fixer montants et règles d'annulation, faire relire les textes.
- Signer les contrats de traitement des données (Google Cloud / Firebase, Stripe, Cloudflare : à accepter
  dans leurs consoles) et tenir le registre des traitements (modèle CNIL).
- Faire faire un **audit de sécurité par un professionnel** (test d'intrusion) : c'est la seule garantie extérieure.
- Le site doit tourner sur **Cloudflare Pages** (étape 5) et non GitHub Pages : GitHub ignore le fichier
  `_headers`, donc les protections du navigateur (CSP, anti-iframe…) ne s'appliquent qu'une fois sur Cloudflare.

### Ce que l'appli protège déjà (vérifié par les tests automatiques)
- Encaissement de la pesée **seulement** avec le QR du client ou son code de retrait à 6 chiffres
  (secret propre à chaque bon, effacé après le retrait).
- Messages, besoins des pros et notifications écrits par le serveur uniquement : les numéros de téléphone
  sont masqués **avant** d'être enregistrés ; espèces, préparations et créneaux pris dans des listes fermées.
- Messagerie ouverte après le paiement, fermée 24 h après le retrait ; e-mail confirmé pour réserver ;
  plafonds de kilos et de réservations non payées ; cadence limitée sur chaque action.
- SIRET des pros contrôlé (clé + répertoire public des entreprises de l'État) : rien à configurer.
- Suivi de chaque commande étape par étape (qui, quand), écrit par le serveur et chaîné : une modification
  après coup se voit. Factures des pros numérotées à la suite (FA-2026-000001), contenu figé, PDF archivé.

### Factures : à faire avant d'ouvrir l'espace pro
- Remplir dans la console Firebase le document `reglages/societe` : `raison`, `capital`, `siret`, `rcs`,
  `tva` (numéro intracommunautaire), `adresse` (sinon la facture affiche des crochets […]).
- Pour chaque pêcheur vérifié, ajouter dans `etals/<id>/prive/infos` : `nomLegal` (nom et prénom) et `siret`.
- Faire valider par l'expert-comptable : taux de TVA (2,1 % poisson, 8,5 % services), mandat de facturation
  (le pêcheur autorise Pêche Connect à facturer en son nom, clause dans les conditions), numérotation unique
  ou par pêcheur, mentions obligatoires.
- Sauvegardes (section 9) : garder les exports de la base **10 ans** pour la collection `factures`.
