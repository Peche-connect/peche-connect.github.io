# Fiches App Store et Google Play — textes prêts à coller

Captures : `captures/` (iPhone 6,7 po 1290 × 2796 et Android 1080 × 2340, dans l'ordre des numéros).
Visuels : `visuels/` (icône App Store 1024, icône Google Play 512, bannière Google Play 1024 × 500).

## Commun aux deux

- **Nom** (30 car. max) : Pêche Connect
- **Catégorie** : Alimentation et boissons (App Store) · Alimentation et boissons (Google Play)
- **Âge** : 4+ (App Store) · PEGI 3 (Google Play). Messagerie entre utilisateurs : oui (privée, après une commande).
- **Adresse du site** : https://peche-connect.fr
- **Confidentialité** : https://peche-connect.fr/legal/confidentialite
- **Assistance** : contact@peche-connect.fr
- **Suppression du compte** : dans l'appli (Mon compte > Supprimer mon compte) et sur le site, même page.
- **Achats** : poisson frais (bien physique) payé par carte via Stripe. Pas d'achat intégré Apple / Google :
  c'est autorisé pour les biens physiques (règle App Store 3.1.3 (e) ; Google Play : biens physiques).

## App Store

- **Sous-titre** (30 car.) : Le poisson frais des pêcheurs
- **Texte promotionnel** (170 car.) : Réservez le poisson du jour directement auprès des pêcheurs de Martinique. Vous ne payez que le poids réel, pesé devant vous au port.
- **Mots-clés** (100 car.) : poisson,pêcheur,martinique,marché,port,frais,thon,vivaneau,langouste,lambi,réservation,local
- **Description** :

```
Pêche Connect relie les pêcheurs professionnels de Martinique et ceux qui veulent du poisson frais.

LE POISSON DU JOUR, EN DIRECT DES PÊCHEURS
Voyez les arrivages port par port : espèces, prix au kilo, quantités, heure de débarquement. Thon jaune, vivaneau, dorade coryphène, thazard, langouste, lambi…

RÉSERVEZ, PAYEZ, RÉCUPÉREZ
Choisissez vos kilos, la préparation (entier, tranches, filets) et votre créneau. Un montant maximum est simplement bloqué sur votre carte : vous ne payez que le poids réel, pesé devant vous au retrait. Le reste est libéré tout de suite.

UN BON DE RETRAIT CLAIR
Code, QR code, adresse exacte du point de retrait et itinéraire (Waze, Google Maps, Plans).

ÉCHANGEZ SANS DONNER VOTRE NUMÉRO
Messages écrits ou vocaux et appels par Internet avec le pêcheur, après votre réservation. Vos numéros restent privés.

POUR LES PÊCHEURS
Publiez votre arrivage en moins d'une minute, recevez des réservations payées d'avance, validez la pesée et soyez payé automatiquement.

POUR LES PROFESSIONNELS
Restaurants, poissonneries, traiteurs : achats en volume, besoins publiés aux pêcheurs, livraison, factures.
```

- **Notes pour la vérification Apple** (à coller, en anglais) :

```
Pêche Connect lets customers in Martinique reserve fresh fish from professional fishermen and pick it up at the port.
Sign in: use "Sign in with Apple" and choose "Particulier" (customer) to browse stalls, reserve and chat.
Payments are for physical goods (fresh fish) and go through Stripe; the card is only pre-authorized, and only the
weighed amount is captured at pickup. The fisherman space requires a verified professional fisherman, so it cannot
be opened with a test account: a demonstration video of the full flow (customer and fisherman) is attached.
Messages are private between the customer and the fisherman of a paid order; phone numbers are masked; users can
report a conversation from the chat screen. Account deletion: Mon compte > Supprimer mon compte.
```

  Joindre la vidéo `design/video/peche-connect-demo.mp4`.

### Confidentialité (« étiquettes » App Store)

| Donnée | Collectée | Liée à l'utilisateur | Pistage | Usage |
| --- | --- | --- | --- | --- |
| Adresse e-mail | Oui | Oui | Non | Fonctionnement de l'appli (connexion) |
| Nom (prénom) | Oui | Oui | Non | Fonctionnement de l'appli |
| Historique d'achats | Oui | Oui | Non | Fonctionnement de l'appli |
| Messages, enregistrements audio | Oui | Oui | Non | Fonctionnement de l'appli (messagerie) |
| Photos (pêcheurs) | Oui | Oui | Non | Fonctionnement de l'appli |
| Position précise (pêcheurs, à leur demande) | Oui | Oui | Non | Fonctionnement de l'appli |
| Informations de paiement | Par Stripe | Oui | Non | Paiement (carte saisie chez Stripe) |
| Identifiants de l'appareil (notifications) | Oui | Oui | Non | Fonctionnement de l'appli |

Aucun pistage, aucune publicité, aucune mesure d'audience.

## Google Play

- **Description courte** (80 car.) : Réservez le poisson du jour auprès des pêcheurs de Martinique.
- **Description complète** : la même que l'App Store.
- **Sécurité des données** : mêmes données que le tableau ci-dessus ; chiffrées en transit ; l'utilisateur peut
  demander leur suppression (dans l'appli et sur le site) ; aucune donnée partagée avec des tiers à des fins
  publicitaires (Stripe et Agora interviennent comme prestataires pour le paiement et les appels).
- **Accès pour les vérificateurs** : connexion Google, profil « Particulier » ; espace pêcheur montré par la vidéo de démonstration.
- **Public cible** : 18 ans et plus (paiement par carte).
