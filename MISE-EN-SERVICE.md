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

## 10. Avant de publier l'appli sur l'App Store et Google Play

App Check pour l'appli installée (App Attest sur iPhone, Play Integrity sur Android) et connexion
Google / Apple natives : à brancher avec la fabrication des applis (EAS). Tant que ce n'est pas fait,
les fonctions serveur refusent les appels de l'appli installée : c'est voulu.

## Avant d'ouvrir au public

- Compléter les crochets […] des pages légales (`app/src/legal.ts`), désigner un médiateur de la
  consommation, fixer montants et règles d'annulation, faire relire les textes.
- Signer les contrats de traitement des données (Google Cloud / Firebase, Stripe, Cloudflare : à accepter
  dans leurs consoles) et tenir le registre des traitements (modèle CNIL).
- Faire faire un **audit de sécurité par un professionnel** (test d'intrusion) : c'est la seule garantie extérieure.
