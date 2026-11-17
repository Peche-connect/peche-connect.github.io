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

## 8. Sécurité et sauvegardes

- Validation en deux étapes sur **tous** les comptes (Gmail, Firebase, Stripe, Cloudflare, GitHub, Zoho, IONOS).
- Firestore > **Sauvegardes** : activer une sauvegarde quotidienne (quelques centimes par mois) et tester
  une restauration une fois par trimestre.
- **Journal** des événements de sécurité : collection `journal` (webhooks rejetés, faux QR, inscriptions à vérifier).
- GitHub > Settings > Code security : *Dependabot alerts* et *Secret scanning* activés.
- En cas de fuite de données : prévenir la CNIL sous 72 h.

## Avant d'ouvrir au public

Compléter les crochets […] des pages légales (`app/src/legal.ts`), désigner un médiateur de la
consommation, fixer montants et règles d'annulation, faire relire les textes.
