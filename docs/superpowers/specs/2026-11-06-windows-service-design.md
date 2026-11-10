# Service Windows autonome et compagnon de session

## Demande et choix confirmé

Le moteur doit devenir un vrai service Windows, démarrer avec la machine, continuer sans fenêtre, conserver ses réglages et se relancer après une panne. L'utilisateur a choisi de conserver USB direct, HID et Bluetooth GATT via un compagnon discret lancé à la connexion Windows. Ces trois modes nécessitent une session connectée ; les transports réseau, COM et file Windows restent gérés par le service.

## Architecture retenue

- Service `SmartEatPrinterAgent`, administré par le gestionnaire de services Windows via WinSW stable. Démarrage automatique différé, reprise après échec, arrêt propre et surveillance du processus de travail.
- Moteur Node autonome sans import Electron, ressources exécutables embarquées dans l'installation, aucun Node à installer sur le poste client.
- Le service est l'unique propriétaire du port public 8989, des files d'impression, de la découverte, des données et des TPE existants. L'interface Electron devient un client ; aucune deuxième instance de moteur n'est lancée à l'ouverture de la fenêtre.
- API de contrôle HTTPS distincte sur `127.0.0.1:8990`, certificat local épinglé et secret conservés dans un dossier aux droits restreints. Le secret ne doit jamais être envoyé au moteur de rendu, à un faux serveur local ou dans les logs.
- Données machine persistantes dans `%ProgramData%/SmartEat/PrinterAgent`, conservées lors des mises à jour et de la désinstallation. Import initial des anciens réglages seulement si aucune nouvelle configuration n'existe.
- Session et URL de récupération des tickets persistées côté service ; aucune dépendance à l'ouverture de l'interface après la première configuration.
- Jobs enregistrés avant envoi ; après un redémarrage, un envoi interrompu dont le résultat est incertain n'est pas rejoué aveuglément.
- Compagnon Electron au login, fenêtre masquée au démarrage, fermeture de fenêtre = masquage, commande explicite pour quitter le compagnon. Les droits et boîtes de sélection des périphériques restent dans cette session.
- Compagnon sans élévation, contrôle IPC limité par preload isolé. L'utilisateur de session autorisé a seulement lecture du secret et des logs, le service garde les écritures.
- Le code exécuté par LocalSystem et ses parents sont protégés ; un dossier d'installation personnalisé non sécurisé est refusé. La distribution utilise l'installateur NSIS, un exécutable portable seul ne peut pas installer ce service machine.
- Pont local authentifié pour les trois transports directs, propagation des annulations et des confirmations de libération déjà implémentées. Compagnon absent = erreur explicite, les autres transports continuent.
- Favoris, ordres des protocoles, erreurs lisibles et corrections d'encodage précédentes sont conservés.

## Contraintes

Pas d'impression réelle ni de lecture exposée des jetons. Ne pas installer/démarrer un service sur le poste de développement pendant les tests. Produire des scripts et un installateur reviewables. Les endpoints TPE et leurs règles métier restent compatibles. Pas de publication externe.

## Alternatives

L'application Electron masquée au login ne répond pas seule au besoin d'un service machine. Migrer les modes directs vers Windows/COM offrirait une autonomie plus large sans session, mais l'utilisateur a explicitement choisi de conserver le compagnon et les protocoles actuels.
