# Pêche Connect

Application mobile de mise en relation entre pêcheurs professionnels et consommateurs en Martinique. Les pêcheurs publient leurs arrivages (espèces, prix au kilo, quantités, port ou marché, heure limite de retrait). Les clients réservent, paient en ligne et récupèrent leur poisson au port ou au marché communal.

Le porteur du projet n'est pas développeur : explique les choix simplement, en français, et avance par petites étapes testables.

## Modèle économique

- Plateforme lucrative : une petite commission sur chaque vente + des frais de service payés par le client (montants à fixer, notés `[…]` dans les maquettes).
- **Anti-contournement, règle centrale** : le numéro et l'adresse exacte du pêcheur ne sont jamais visibles avant le paiement. Les échanges passent par une messagerie intégrée (numéro relais masqué en option, type Twilio).
- Valeur ajoutée qui retient les utilisateurs : paiement garanti, fin des réservations non honorées, alertes sur les espèces, traçabilité (bateau, zone de pêche), avis, fidélité.

## Paiement

- Place de marché : **Stripe Connect** (disponible en Martinique), comptes vendeurs vérifiés pour les pêcheurs, reversement automatique, commission prélevée au passage. Alternatives : Mangopay, Lemonway.
- Le poids réel n'est connu qu'à la pesée : **empreinte bancaire (capture manuelle)** à la réservation sur un montant max (~+10 %), puis encaissement du montant exact quand le pêcheur valide la pesée. Le reste est libéré.
- Certaines espèces (poisson volant, lambi) peuvent être vendues en lots à prix fixe.
- TVA Martinique : 8,5 % normal, 2,1 % réduit — à confirmer avec un comptable.
- Règles d'annulation à définir : pêcheur en rupture, client absent, délai avant remise en vente.

## Expérience utilisateur

- Inspiration : **Uber Eats** (pratique avant tout). Chaque pêcheur = un « étal » présenté comme un restaurant : photo d'ambiance, note, distance, espèces, heure de débarquement.
- Parcours client : Accueil (commune, recherche, filtres espèces, « Arrivé il y a moins d'une heure ») → Étal (poissons avec + / −, prix au kilo, dispo) → Panier (préparation : entier / tranches / filets, créneau de retrait, paiement) → Bon de retrait (code + QR, adresse exacte débloquée, messagerie).
- Parcours pêcheur : publier en moins d'une minute sur téléphone (photo, dictée vocale, + / − sur les kilos, prix de la veille pré-remplis), voir les réservations, valider la pesée, clôturer la vente.
- **Photos** : ports, marchés, yoles, débarcadères **et aussi les arrivages de poisson** (le porteur a envoyé des photos d'étals de poisson : la règle « pas de poisson » est levée). **Retirées de la démo le 23/10/2026 (le porteur n'aime pas le rendu)** : les étals affichent des cadres neutres ; les fichiers sont gardés hors du dépôt. Photos libres de droits (Unsplash, Pexels, Wikimedia Commons avec crédit) ou prises sur place. **Exception (validée par le porteur le 24/10/2026)** : deux photos d'ambiance dans l'appli, `app/assets/ambiance/yoles.jpg` (écran de connexion) et `thon.jpg` (bandeau de l'accueil, recadré sans visage). Provenance à confirmer par le porteur. Les autres photos ne sont pas dans ce dépôt (droits non vérifiés) : elles sont dans la sauvegarde zip du porteur. Avant toute réutilisation : vérifier droits, personnes reconnaissables, plaques d'immatriculation.

## Identité visuelle (validée)

- Esprit **pratique et consommation**, type appli de courses / Uber Eats. Pas d'ambiance « vacances » ni carte postale, pas de rendu « fait par une IA » (pas de pictogrammes : le porteur préfère les logos en lettres).
- **Nom** : Pêche Connect. **Phrase** : « Réservez. Payez. Récupérez. »
- **Logo « le panneau »** : « PÊCHE / CONNECT » sur deux lignes en Bebas Neue bleu `#0057d9`, un trait vertical bleu, puis la phrase en colonne (Figtree 800, noir). Sur fond noir : nom en blanc, trait `#4d8dff`. Petits formats : « PÊCHE CONNECT » sur une ligne. **En-tête de l'appli : « PÊCHE / CONNECT » écrit en entier sur deux lignes (Bebas Neue, couleur du logo) avec un trait vertical à droite** — pas de sigle « PC » dans l'appli (choix du porteur). Icône sur l'écran du téléphone : « PC » en Bebas Neue blanc sur carré de la couleur du logo (trop petit pour le nom entier). Couleur du logo : marine `#12355b` (voir ambiance ci-dessous). Planche : `logos/logo-final.html`.
- **Fond de l'appli : blanc**, plus aucun beige (essais beige du 16/11/2026 abandonnés, y compris le cartouche beige du logo, le 17/11/2026).
- **Ambiance retenue (provisoire) : « Marine et gris »**. Bleu marine `#12355b` pour le logo, les boutons d'action et les sélections. Gris `#e5e5e2` (texte noir) à la place de la couleur d'accent : prix au kilo, créneau de retrait, compteur du panier, repères « arrivé il y a moins d'1 h ». Le gris est un remplaçant temporaire : une 2e couleur sera choisie plus tard. Écartés : orange, jaune, bleu lagon, menthe.
- **La référence visuelle est l'appli elle-même (`app/`, en ligne sur https://peche-connect.github.io/)**. L'ancienne démo HTML `demo/app-demo/` est gardée pour mémoire mais retirée du site (`/demo/` redirige vers l'appli, 17/11/2026). Les maquettes statiques de `design/maquettes-noir-orange/` sont marquées « Ancienne maquette » (bandeau + `LISEZMOI.md`).
- **Icône** : « PC » Bebas Neue blanc sur carré marine `#12355b` : `app/assets/icones/` (icon, adaptive-icon, favicon, splash), générée par script ; favicon du site via `app/public/index.html` (gabarit HTML, `lang="fr"`).
- **Couleurs neutres de l'interface** : texte `#111111`, blanc, gris clair `#f3f3f1` (fonds secondaires), séparateurs `#e5e5e2`, texte secondaire `#62625d`. Statuts : vert `#12805c` (« 22 kg dispo »), rouge-orangé `#c2410c` (« Bientôt épuisé »), toujours avec un mot.
- **Typo** : Figtree pour toute l'interface ; Bebas Neue seulement pour le logo.
- **Personnage « le pêcheur Pêche Connect » (planche validée par le porteur le 17/11/2026)** : casquette marine, barbe grise, t-shirt blanc, tablier marine marqué « PÊCHE CONNECT ». Poses détourées (fond transparent) dans `app/assets/personnage/`, chacune là où sa posture convient :
  - **logo** (`Logo`, tous les en-têtes) : **`tend.png`, le pêcheur de la planche qui tend son vivaneau** (planche « de référence » du 17/11/2026 : face, profil, dos, pose qui tend le poisson), juste après « PÊCHE », sur fond blanc. `tend-entier.png` = la pose complète. Photo de profil WhatsApp correspondante : `design/logos/photo-profil-beige-pecheur-v2.png` ;
  - **logo imprimé sur les tabliers corrigé (17/11/2026)** : sur toutes les poses (`tend`, `poisson-fier`, `decoupe`, `pouce`), l'ancien « PÊCHE CONNECT » est recouvert et remplacé par le vrai logo en blanc avec le mini-pêcheur (détouré d'un liseré blanc) après « PÊCHE ». Aperçu : `design/tabliers-logo-corrige.png`. `tete-rire.png` n'a pas de texte visible ;
  - **connexion / bienvenue** : **photo des yoles `app/assets/ambiance/yoles.jpg` remise le 17/11/2026 à la demande du porteur** (`poisson-grand.png` n'y est plus) ;
  - `poisson-fier.png` : **bandeau de l'accueil** (« Le poisson du jour… ») ;
  - `decoupe.png` : **panier**, encart « Entier, en tranches ou en filets » ;
  - `pouce.png` : **bon de retrait**, « C'est réservé ! » (masqué une fois retiré) ;
  - `tete-rire.png` : **messages vides** (`Vide`, option `perso`, activée par défaut).
  Source : planche envoyée par le porteur (`1280×853`), à garder en haute définition ; provenance / droits à confirmer avant dépôt de marque. Anciennes pistes (pêcheur à casquette bleue avec bac, pêcheur au chapeau de paille) : fichiers gardés dans `app/assets/embleme/`, plus utilisés.
- **Photos de profil (WhatsApp, réseaux)** : `design/logos/photo-profil-*.png` (marine, blanc, beige, sable, grège, taupe).
- **Bon de retrait** : carte simple et droite sur fond blanc (code + QR, créneau en jaune, adresse, boutons Itinéraire / Message). Le ticket incliné n'est plus utilisé.
- **Itinéraire** : le bouton ouvre un choix Waze / Google Maps / Plans (+ « Copier l'adresse »), via liens profonds. Logos officiels à intégrer au développement selon leurs chartes.
- **Messagerie** : ouverte seulement après la réservation, numéros masqués, réponses rapides (« J'arrive dans 10 min »…), appel via numéro relais.
- **Position du pêcheur** : depuis le chat, le pêcheur envoie sa position — en direct jusqu'à la fin du retrait, une seule fois, ou son point de vente habituel. Le client reçoit une carte dans le chat avec « Y aller » (→ Waze / Google Maps / Plans). Visible uniquement par les clients du jour avec un bon payé.
- **Carte des arrivages (style « A · Épurée claire », validé le 17/11/2026, propositions : `design/carte-propositions.png`)** : carte maison `src/components/CarteIle.tsx` — silhouette de l'île (`app/assets/carte-ile.png`, île blanche, mer `#ddeaf2`, tirée du trait de côte OSM), sans routes ni noms de villes. Vue d'ensemble : points pour tous les ports (plus gros = port territorial) et étiquettes seulement pour les ports avec arrivages (« Le Robert · 2 », noire ; blanche si arrivé il y a moins d'1 h). **Zoom** : deux doigts, glisser, boutons + / − (×1 à ×4) ; à partir de ×1,7 les noms de tous les ports apparaissent. Côté de chaque étiquette réglé à la main (`cote` dans `PORTS`). Volet du bas avec les étals du port choisi. Plus tard, dans l'appli installée : éventuellement une vraie carte (react-native-maps).
- `design/charte/` (palette « glace / lagon / vivaneau ») et le bleu lagon `#1e6e78` sont abandonnés.

## Contexte Martinique à respecter

- Ports et lieux : **réseau officiel du Comité régional des pêches (carte « Le réseau de la pêche martiniquaise », envoyée par le porteur le 17/11/2026)** — ports territoriaux : Grand-Rivière, Trinité, Case-Pilote, Le François, Le Vauclin, Les Anses-d'Arlet, Le Diamant, Le Marin ; APIT (aménagements / abris de pêche d'intérêt territorial) : Basse-Pointe, Le Prêcheur, Saint-Pierre, Le Carbet, Fond Lahaye, Le Marigot, Tartane, Le Robert, Le Lamentin, Ducos, Les Trois-Îlets, Sainte-Luce, Sainte-Anne ; plus Fort-de-France (marché) et Belle-Fontaine (débarcadère des données de démo). Tous dans `PORTS` (`src/data/demo.ts`, champ `type`, coordonnées approximatives) ; affichage : voir « Carte des arrivages ».
- Noms d'espèces locaux : thazard, coulirou, balaou, colas, chatrou, dorade coryphène, vivaneau, thon jaune, langouste, lambi.
- Réglementation : vente directe par pêcheur professionnel, traçabilité, hygiène pour le nettoyage (à vérifier auprès de la Direction de la Mer et de la DAAF). Zones interdites (chlordécone) et périodes de fermeture (lambi, langouste) : la plateforme pourrait les bloquer.
- Adoption par les pêcheurs = le vrai défi : interface ultra simple, accompagnement à l'inscription Stripe, passer par le comité des pêches et les coopératives.

## Contenu du dossier

- `design/maquettes-noir-orange/` (nom historique, l'accent est désormais jaune) : **les 10 écrans à jour**, HTML statique 390×844 — 1 accueil, 2 étal, 3 panier, 4 bon de retrait, 5 pêcheur publier, 6 carte des arrivages, 7 messagerie, 8 itinéraire, 9 position reçue (client), 10 envoyer ma position (pêcheur). Référence visuelle pour le développement. Captures dans `design/apercus-noir-orange/` (`0-les-8-ecrans.png`).
- `design/logos/` : logo final (`logo-final.html`) et pistes explorées.
- `design/maquettes/` : les 5 écrans d'origine (ancien style bleu lagon), gardés pour mémoire. Les dossiers `maquettes-theme-a/`, `maquettes-etal-noir/`, `maquettes-mix/` sont des essais intermédiaires.
- `design/prototype/prototype-v1.html` : premier prototype fonctionnel (ancien style, données d'exemple, numéro visible — à ne pas reprendre tel quel).
- `design/charte/` : tokens et règles de rédaction de la première charte.

## Prochaines étapes proposées

1. ~~Aligner l'écran pêcheur sur le style des écrans 1 à 3~~ (fait, dans `design/maquettes-noir-orange/`).
2. Ajouter les écrans manquants : bienvenue / connexion, mes bons, espace pêcheur (réservations + pesée). (Carte, messagerie et itinéraire : faits.)
3. Intégrer les photos d'ambiance.
4. Rédiger le cahier des charges.
5. Développer : stack suggérée **React Native (Expo) + Supabase** (comptes, base, temps réel) **+ Stripe Connect** ; lancement pilote sur une ou deux communes.

## Organisation du dépôt (GitHub : Peche-connect/peche-connect.github.io, organisation « Peche-connect », ex-GLRW/P-che-Connect)

- `app/` : **la vraie application** (Expo / React Native, TypeScript, une seule base de code pour iPhone, Android et web). Tourne en « mode démo » (données locales) tant que Supabase et Stripe ne sont pas configurés.
  - `app/app/` : écrans (expo-router). `app/src/` : thème, types, données de démo, services.
  - `app/supabase/` (recréé le 17/11/2026, l'ancien était perdu) : `migrations/` (schéma, règles d'accès RLS, rôles client / pro / pêcheur / chauffeur / admin avec 2FA, fermetures lambi et langouste, photos, tâches pg_cron), `functions/` (Deno : creer-reservation, stripe-webhook signé, valider-pesee, verifier-bon, payer-bon, compte-paiement, accepter-demande, compte = export / suppression, notifier, envoi-sms limité), `tests/` (50 tests RLS sur Postgres local avec `imitation_supabase.sql`), `functions/_tests/` (montants, QR signé, webhook). `src/services/backend.ts` : toutes les requêtes de l'appli.
  - **Mise en service pas à pas : `MISE-EN-SERVICE.md` à la racine.** Vérifications automatiques : `.github/workflows/verifications.yml` ; Dependabot : `.github/dependabot.yml`.
  - Construire la version web : `cd app && npm install && EXPO_OFFLINE=1 npx expo export --platform web` (le service de versions d'Expo est bloqué dans l'environnement cloud : les versions sont fixées à la main pour le SDK 52, `query-string` ajouté explicitement pour expo-router).
- `demo/` : démo HTML fonctionnelle (`demo/app-demo/index.html`, en ligne sur claude.ai) et prototype cliquable.
- `design/` : maquettes, logos, charte, captures (sans photos).
- `docs/` : site GitHub Pages (https://peche-connect.github.io/). **La vraie appli est à la racine** (export web d'Expo, `baseUrl` vide dans app.json) ; `docs/404.html` = copie de `docs/index.html` pour que les liens profonds fonctionnent ; `docs/demo/` = la démo HTML ; `.nojekyll` obligatoire (dossier `_expo`). Après chaque modif de l’appli : `cd app && npx tsc --noEmit && EXPO_OFFLINE=1 npx expo export --platform web --clear` (`--clear` obligatoire : sinon le cache garde les anciennes valeurs de `.env`), puis recopier `app/dist/.` dans `docs/` (sans effacer `docs/demo/`) et `docs/index.html` vers `docs/404.html`. QR codes : `demo/qrcode-app.png` (appli) et `demo/qrcode-site.png` (démo).

## État de l'appli (`app/`)

- **Écrans faits** (mode démo, données sur le téléphone) : connexion par téléphone + code SMS (démo : 123456), choix client / pêcheur ; inscription pêcheur (prénom, port, bateau, immatriculation → vérification → compte de paiement) ; client : accueil (commune, recherche, filtres), carte OSM avec repères, étal (+ / − par 500 g, réglage fin 100 g), panier (préparation, créneau, montant bloqué), bon de retrait (code, QR, itinéraire Waze / Google Maps / Plans), mes bons, messages, chat (numéros masqués, position du pêcheur) ; pêcheur : arrivage (prix et kilos modifiables, ajout d'espèce, mise en vente), réservations, pesée (montant réel ≤ montant bloqué), messages, envoi de position.
- **Espace professionnel** (restaurants, poissonneries, revendeurs, traiteurs) : choix « Professionnel » à la connexion → `inscription-pro` (établissement, type, SIRET 14 chiffres, commune, adresse de livraison). Côté client pro : + / − par 1 kg et quantités rapides jusqu'à 20 kg ; onglet **« Besoins »** pour publier une demande (espèce, kg, prix max/kg, aujourd'hui / demain, note, retrait ou livraison) ; **livraison par chauffeur** possible dès `LIVRAISON_MIN_KG` (10 kg) pour `FRAIS_LIVRAISON` (15 €, provisoire) ; **facture** sur le bon (raison sociale, SIRET, HT / TVA 2,1 % à confirmer / TTC). Côté pêcheur : onglet **« Besoins pros »** → « Je peux fournir » crée la commande (bon) et un message ; repère « Pro · type » et « Livraison par chauffeur » dans les réservations. À faire : appli / espace chauffeur (tournées, suivi), tarifs pro, facturation mensuelle, montants définitifs.
- Le « cerveau » est `src/store.tsx` (toutes les actions). **Mode réel automatique** dès que `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` sont dans `app/.env` (voir `.env.example`) : chaque action appelle `src/services/backend.ts` ; sinon mode démo inchangé. Connexion réelle : Google (par défaut) et/ou SMS (`EXPO_PUBLIC_CONNEXION_SMS=1`), puis choix du rôle à la 1re connexion.
- **Fait le 17/11/2026** : vrai QR code (lib `qrcode`) contenant le lien signé `…/pesee/<code>?s=<signature HMAC>`, vérifié par le serveur quand le pêcheur le scanne ; photo de la pêche (expo-image-picker, dossier Storage `arrivages/<étal>/`) ; dictée de l'arrivage (reconnaissance vocale du navigateur ou micro du clavier, `src/dictee.ts`) ; position réelle du pêcheur (GPS) effacée automatiquement ; espèces fermées bloquées (`src/data/fermetures.ts` + trigger serveur) ; « Mon compte » : alertes d'espèces, télécharger mes données, supprimer mon compte, relevé mensuel des pros ; pages légales `/legal/mentions`, `/legal/confidentialite`, `/legal/conditions` (`src/legal.ts`, crochets […] à compléter) ; bandeau d'erreur serveur global.
- **Reste à faire** : créer les comptes et brancher (`MISE-EN-SERVICE.md`) ; écrans chauffeur (la base gère déjà le rôle et `chauffeur_id`) ; carte vivante (react-native-maps) dans l'appli installée — le site utilise la carte maison `CarteIle` (image fixe tirée du trait de côte OSM), donc aucune requête aux serveurs de tuiles OSM ; builds iPhone / Android (EAS) ; décisions entre associés (montants dans la table `reglages`, annulation, TVA).
