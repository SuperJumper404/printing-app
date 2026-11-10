# Service Windows SmartEat

Le programme d’installation NSIS enregistre le service **SmartEatPrinterAgent**, en démarrage automatique différé sous **LocalSystem**. Le service est l’unique moteur sur le port 8989. Il démarre sans connexion Windows, conserve les réglages et continue quand la fenêtre Electron est fermée.

Le dossier du programme contient du code exécuté par LocalSystem. L’installateur vérifie donc le dossier choisi et tous ses parents avant extraction, pour les installations interactives et silencieuses. Un emplacement personnalisé doit avoir un parent local NTFS/ReFS existant, détenu et protégé par SYSTEM/Administrateurs/TrustedInstaller. Les emplacements modifiables par un utilisateur, les partages et les chemins redirigés sont refusés ; choisir Program Files ou demander à un administrateur de créer un parent sécurisé. Aucun ACL d’ancêtre extérieur au dossier d’installation n’est modifié. Le dossier complet de l’application, y compris l’interface, `app.asar`, les exécutables, XML et modules natifs du service, est protégé contre l’écriture des utilisateurs ; le compagnon autorisé dispose de lecture/exécution. Une ancienne installation non sécurisée est refusée avant d’exécuter son désinstalleur.

| Disponible sans session Windows | Nécessite le compagnon connecté |
| --- | --- |
| TCP ESC/POS, IPP, LPR, ePOS HTTP | USB direct WebUSB |
| File d’impression Windows | HID direct WebHID |
| COM USB, COM Bluetooth classique | Bluetooth GATT |

Les imprimantes Windows doivent être installées pour la machine et accessibles à LocalSystem. Une file installée uniquement dans le profil d’un utilisateur peut être invisible au service. Le service ne présente pas les boîtes de sélection USB/HID/GATT : le compagnon Electron s’en charge dans la session de l’utilisateur autorisé. Quand cette session est fermée, ces trois modes signalent son absence ; les sept autres transports continuent.

## Données et compte autorisé

Les fichiers persistants restent dans `%ProgramData%\SmartEat\PrinterAgent`. Ils sont conservés pendant une mise à jour et après désinstallation : réglages, session SmartEat, historique, journal des jobs, autorisation du compagnon et logs. Un ancien `settings.json` est importé avant suppression de l’ancienne installation, seulement si le nouveau fichier n’existe pas. Le fichier source n’est jamais réécrit par l’import.

SYSTEM et Administrateurs disposent du contrôle total. Un seul SID utilisateur reçoit la lecture de `connection.json`, `control-token` et des logs, ainsi que la traversée du dossier. Il ne reçoit aucune écriture directe dans les données du service. Les réglages et jobs restent privés à SYSTEM/Administrateurs. Aucun droit de lecture n’est accordé à Everyone ou au groupe Users. L’interface communique avec le service par son API locale authentifiée ; son secret reste dans le processus principal Electron.

Le contrôle utilise HTTPS sur `127.0.0.1:8990`. Le certificat de cette installation est épinglé par le compagnon avant l’envoi du secret ; aucun certificat n’est ajouté au magasin de confiance Windows. La clé privée PFX reste réservée à SYSTEM/Administrateurs. Une interruption de génération est récupérée au démarrage suivant. L’API d’impression compatible reste sur le port 8989.

L’installateur choisit le propriétaire d’Explorer dans sa session, puis conserve ce SID dans `authorized-companion.sid` pour les mises à jour. Une installation distante ou avec plusieurs comptes peut préciser `-CompanionUserSid S-1-...`. Le SID retenu ne change pas à chaque mise à jour.

Le démarrage du compagnon est enregistré dans **HKLM Run**, avec le chemin complet entre guillemets et `--hidden`. Electron s’exécute sans élévation. L’installateur retire seulement les anciens démarrages SmartEat reconnus du profil autorisé, lorsque leur chemin correspond exactement à l’exécutable courant ou à celui de l’ancienne installation. Les autres entrées restent intactes. La fermeture de la fenêtre masque le compagnon ; sa commande Quitter est explicite. Un autre utilisateur qui ouvre une session n’obtient pas automatiquement le secret du compte autorisé.

## Construire

Sur Windows x64, avec le Node officiel signé utilisé pour la construction :

```powershell
npm.cmd run build:service
npm.cmd run release:win
```

`service-dist` contient le Node autonome, `agent.cjs`, `supervisor.cjs`, le wrapper WinSW et sa configuration, les dépendances natives série, les licences et un manifeste SHA256. Electron Builder les place dans `resources\service`, hors de `app.asar`. Aucun Node ni téléchargement n’est nécessaire chez le client.

La branche 4.1 se distribue avec l’installateur NSIS. Une version portable seule ne peut pas enregistrer et protéger un service Windows machine.

L’installateur 4.1.0 pouvait afficher à tort « ancien dossier non sécurisé » même dans Program Files : Windows PowerShell 5.1 ne disposait pas encore du chemin du script lors du calcul d’un paramètre par défaut. La version 4.1.1 corrige ce démarrage ; les contrôles des permissions restent actifs. Utiliser le nouvel installateur sans modifier les droits de Program Files.

La version 4.1.2 corrige également un conflit de chargement des modules PowerShell qui empêchait la préparation des données dans 4.1.1. La préparation initiale et les mises à jour sont testées avec un vrai processus administrateur, dans un dossier temporaire et dans les deux architectures PowerShell. Pour lancer ces tests depuis une console administrateur : `$env:SMARTEAT_RUN_PRIVILEGED_TESTS='1'; node --test test/servicePackaging/privilegedData.test.cjs`. Ils ne créent aucun service et n’utilisent aucune donnée réelle du poste.

WinSW est figé en **2.12.0 x64**. Le premier téléchargement utilise exclusivement l’asset HTTPS officiel GitHub ; son SHA256 est contrôlé avant mise en cache et à chaque réutilisation. La provenance et l’empreinte sont enregistrées dans `build/windows-service/winsw.json`. Cette ancienne release ne fournit pas d’empreinte publiée et son exécutable est non signé : l’empreinte figée a été calculée à partir du téléchargement officiel. La branche WinSW 3 alpha n’est pas utilisée.

Node est copié depuis le runtime Windows de construction après validation Authenticode du signataire OpenJS Foundation/Node.js Foundation. Sa version et son empreinte sont inscrites dans le manifeste. Le runtime de cette construction est Node **22.13.1** ; pour une mise à jour de Node, ajouter également sa licence officielle correspondante dans `build/windows-service/LICENSE-Node-vX.Y.Z.txt`. Les bindings série N-API Windows x64 et toutes leurs dépendances d’exécution sont inclus. Les imports `.mjs` littéraux sont intégrés au bundle.

## Administrer

Depuis une console administrateur, adapter les chemins à l’installation :

```powershell
$tools = 'C:\Program Files\SmartEat Printer Agent\resources\windows-service\manage.ps1'
$service = 'C:\Program Files\SmartEat Printer Agent\resources\service'
$app = 'C:\Program Files\SmartEat Printer Agent\SmartEat Printer Agent.exe'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tools -Action Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tools -Action Stop -ServiceDir $service
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tools -Action Update -ServiceDir $service -AppExe $app
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tools -Action Uninstall -ServiceDir $service
```

`Install` et `Update` contrôlent et protègent le dossier du programme, contrôlent le manifeste, réenregistrent le service, conservent les données et démarrent la nouvelle instance. Avant d’extraire les fichiers d’une mise à jour, l’installateur appelle `PrepareInstall -InstallRoot ...` avec le nouveau script embarqué : il valide le chemin final, arrête le service par son nom SCM constant et attend son arrêt. Il n’exécute aucun ancien script installé pour cette étape. `ValidateInstall` effectue seulement le contrôle de chemin. `Uninstall` retire le service et son démarrage compagnon ; les données machine sont gardées. `PrepareData` prépare les permissions et effectue l’import initial, sans enregistrer de service. `-WhatIf` permet de demander l’opération prévue sans l’appliquer. Ne jamais copier un vrai secret ou le contenu de `settings.json` dans un diagnostic partagé.

Le statut reste disponible avec `Get-Service SmartEatPrinterAgent`. Les logs se trouvent dans `%ProgramData%\SmartEat\PrinterAgent\logs`, dont `installer.log` et les logs roulants WinSW. Ils sont préservés lors des mises à jour et de la désinstallation. L’installation réelle et les impressions matérielles n’appartiennent pas aux tests automatisés.

## Reprise et arrêt

Le worker envoie un heartbeat toutes les cinq secondes. Le superviseur traite un démarrage sans réponse après 60 secondes, puis une absence de heartbeat après 30 secondes. Il demande d’abord l’arrêt par IPC, attend dix secondes, puis termine l’arbre du worker si nécessaire. Il ne lance aucune nouvelle instance tant que la sortie de l’ancienne n’a pas été observée. Les erreurs de terminaison provoquent un échec du superviseur pour laisser Windows reprendre la main.

Lors d’un arrêt SCM, WinSW lance `supervisor.cjs --stop`, qui dépose une demande dans le dossier machine protégé. Le superviseur la prend en compte sous une seconde et arrête le worker proprement. Les signaux SIGINT, SIGTERM et SIGBREAK utilisent le même chemin. WinSW dispose de 30 secondes pour l’ensemble de l’arrêt. Ses reprises après panne attendent successivement 10, 30 puis 60 secondes, sans redémarrage de Windows. Un ticket interrompu potentiellement transmis reste incertain et n’est pas rejoué automatiquement.

Sources : [WinSW 2.12.0](https://github.com/winsw/winsw/releases/tag/v2.12.0), [configuration WinSW](https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md), [licence Node 22.13.1](https://github.com/nodejs/node/blob/v22.13.1/LICENSE).
