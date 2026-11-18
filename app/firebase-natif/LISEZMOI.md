Le jour J, déposer ici les deux fichiers téléchargés depuis la console Firebase
(Paramètres du projet > Vos applications) :

- `google-services.json` (application Android `fr.pecheconnect.app`)
- `GoogleService-Info.plist` (application iOS `fr.pecheconnect.app`)

Ils activent l'anti-robots (App Check) dans l'appli installée. Ils ne contiennent pas de secret,
mais restent hors du dépôt public (voir .gitignore).
