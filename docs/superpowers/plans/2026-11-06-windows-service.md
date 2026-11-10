# Windows Service Implementation Plan

> **For agentic workers:** Use superpowers:dispatching-parallel-agents for isolated domains, TDD for changed behavior, then one independent whole-change review.

**Goal:** Installer un vrai moteur Windows autonome et garder les transports directs dans un compagnon discret.

**Architecture:** Moteur Node sans Electron ; WinSW et supervision ; stockage machine ; API publique compatible et contrôle local authentifié ; Electron client et pont matériel de session.

**Tech Stack:** Node.js, Electron, Vue, WinSW, PowerShell/NSIS, node:test.

**Spec:** docs/superpowers/specs/2026-11-06-windows-service-design.md

## Global Constraints

- Conserver tous les protocoles activés et leur envoi successif par imprimante.
- USB direct/HID/GATT nécessitent le compagnon connecté à Windows, choix confirmé par l'utilisateur.
- Le service est l'unique moteur et propriétaire du port 8989.
- Contrôle local uniquement, port 8990 et secret jamais exposé au renderer/logs.
- Réglages machine dans ProgramData ; ne jamais écraser une configuration existante lors d'un import ou d'une mise à jour.
- Pas d'installation réelle du service, impression réelle, exposition des jetons ou publication pendant les tests.

## Review Focus

- Fermer l'interface ou se déconnecter : le service réseau/COM continue, les modes directs signalent l'absence de compagnon.
- Redémarrage machine/processus : réglages/session conservés, pas de double moteur ni de rejeu incertain.
- Pont coupé pendant l'impression : annulation/libération et verrous physiques conservés.
- Installation/mise à jour/désinstallation : chemins avec espaces, données conservées, anciens paramètres importés une seule fois.
- Contrôle local sans secret ou origine navigateur : aucune modification ni fuite de données.

### Task 1: Moteur autonome
Files: lib/agent/runtime.js, store.js, durableJobs.js ; service/worker.js ; tests/agent.
Interfaces: createAgentRuntime({store,bridge,dataDir,version,controlToken,publicPort=8989,controlPort=8990,...}) -> {start,stop,control(action,payload),status}. Control actions gardent les noms IPC existants ; POST /control {action,payload} -> {ok:true,value} ou {ok:false,error:{message,code}}. Auth Bearer sur port loopback, aucune CORS publique pour contrôle. bridge.request(operation,payload,timeoutMs,{signal}) et bridge.control(action,payload), status/stop.
- [x] Tests en échec pour service sans Electron, persistance, réception/polling autonome, routes existantes, auth et arrêt.
- [x] Extraire les fonctions utiles de index.js vers le service, utiliser les transports/coordinations existants et une file durable.
- [x] Vérifier tests ciblés et communiquer interfaces exactes.

### Task 2: Pont compagnon
Files: lib/agent/companionBroker.js ; lib/desktop/companionClient.js ; tests/agent et desktop dédiés.
Interfaces: createCompanionBroker({clock,...}) -> {request,control(action,payload),status,stop}; control actions companion:poll/respond/disconnect avec instanceId ; createCompanionClient({serviceClient,ipcMain,webContents,instanceId}) -> {start,stop}. serviceClient.request(action,payload,{signal,timeoutMs}) renvoie value déballée.
- [x] Tests échec pour absence, reconnect, mauvais propriétaire, annulation et confirmation de libération.
- [x] Réutiliser createDeviceBridgeClient et les canaux renderer existants ; pas de secret dans renderer.
- [x] Vérifier tests ciblés et indiquer contrôle d'instance/lease.

### Task 3: Installation et supervision
Files: scripts/windows-service/* ; build/windows-service/* ; service/supervisor.js ; scripts/build-service.js ; tests/servicePackaging.
Interfaces: build produit service-dist/agent.cjs (service/worker.js), supervisor.cjs, node.exe, WinSW.exe et config service. Ressources installées sous resources/service. Installation enregistre SmartEatPrinterAgent avec données ProgramData, démarrage automatique différé, reprise sur crash ; NSIS appelle install/update/uninstall sans effacer les données. Node runtime et wrapper embarqués, versions/hashes vérifiés.
- [x] Tests échec pour chemins, config WinSW, sauvegarde/import et arrêt/reprise du worker.
- [x] Scripts idempotents, téléchargement contrôlé à la construction, superviseur avec heartbeat du worker.
- [x] Vérifier syntaxe PowerShell, build local, sans enregistrer de service réel.

### Task 4: Client Electron et intégration
Files: index.js, lib/desktop/main.js/serviceClient.js ; package.json ; src/main.js/App.vue si nécessaire ; tests/desktop.
- [x] Tests échec pour proxies IPC, reconnexion service et maintien du compagnon après fermeture de fenêtre.
- [x] Remplacer moteur Electron par client de contrôle, conserver permissions et sélection matérielle, PDF/historique et mises à jour ; aucune dépendance du service à l'UI.
- [x] Intégrer build/installateur et documenter démarrage, état et limites de session.
- [x] Tests complets, syntaxe et build frontend + smoke test service réel dans processus isolé avec ports temporaires/données synthétiques + revue indépendante.

## Execution record

- Même branche que les corrections précédentes, changements préservés. L'utilisateur a explicitement choisi la variante avec compagnon après explication des impacts.
- Moteur autonome, journal persistant et client Electron séparés ; le service reste seul propriétaire du port 8989. Les réglages et la récupération des tickets restent disponibles sans interface.
- Reprise des destinations explicitement non envoyées, sans rejouer une destination réussie ou incertaine. Rétention des tickets terminés bornée, empreintes de déduplication conservées. Verrou système du worker et identité de création du processus compagnon pour gérer crash et réutilisation de PID.
- Contrôle HTTPS local avec certificat épinglé, régénération atomique du PFX corrompu et secret hors du moteur de rendu. Installateur avec contrôle des chemins et des permissions avant extraction, arrêt de l'ancien service et conservation des données.
- Revue indépendante globale effectuée et défauts importants corrigés avec régressions : reconnexion après redémarrage du broker, portée des verrous matériels, reprise des erreurs non envoyées, historique des interruptions et sécurité de l'installation.
- Essai avec le vrai Electron et un service isolé : compagnon connecté, moteur de rendu sans accès Node, favori placé en tête et persisté, fermeture masquant la fenêtre, service encore accessible après sortie du compagnon. Aucune écriture matérielle.
- Le contrôle du premier paquet construit a détecté l'exclusion automatique de `node_modules` à la racine des ressources par Electron Builder. Régression reproduite en échec puis corrigée avec une copie explicite des dépendances du service, y compris bindings natifs et dépendances imbriquées.

## Validation finale

- `npm.cmd test` : 345 tests réussis, aucun échec ; `node --check index.js` et compilation Vite réussis.
- Ressources réelles de `dist6/win-unpacked/resources/service` : 232 empreintes SHA256 conformes au manifeste. Copie dans un dossier temporaire hors du projet, démarrage avec le Node embarqué, version 4.1.0, contrôle HTTPS authentifié, API publique et arrêt propre par le superviseur vérifiés.
- Installateur NSIS construit avec succès, sans publication : `dist6/SmartEat Printer Agent Setup 4.1.0.exe`, 142994288 octets, SHA256 `74ad90dc11ba68bcef8a3c3378854f470d8f2b7bbd0ee1cd204cc177536b091f`.
- Tests avec données synthétiques et ports temporaires. Aucun service enregistré sur le poste, aucune impression physique, aucun réglage privé modifié et aucune publication externe. L'installation machine et les essais sur les imprimantes clientes restent à effectuer.

## Correctif installation du 9 novembre 2026

- Refus « ancien dossier non sécurisé » reproduit avec le point d'entrée réel `powershell.exe -File manage.ps1`, en 32 et 64 bits. Le dossier installé `C:\Program Files\SmartEat Printer Agent` passe le contrôle ACL direct ; l'échec provient de `$PSScriptRoot` encore vide pendant l'évaluation de la valeur par défaut de `ServiceDir` dans Windows PowerShell 5.1.
- Calcul du chemin déplacé dans le corps du script, après liaison des paramètres. Aucun assouplissement des droits ni modification des ACL du poste.
- Cinq régressions observées en échec puis validées : contrôle positif et statut depuis un autre répertoire dans les deux architectures, maintien du refus d'un emplacement utilisateur modifiable. Précontrôle réel de l'ancienne installation validé sans la modifier.
- Version de correctif 4.1.1 pour distinguer le nouvel installateur de la construction initiale.
- `npm.cmd test` : 350 tests réussis, aucun échec. Compilation Vite et syntaxe du point d'entrée Electron validées.
- Paquet final 4.1.1 : 232 fichiers conformes au manifeste, moteur embarqué démarré et arrêté proprement, contrôle HTTPS et API publique validés sans matériel. Script de gestion empaqueté identique à la source ; précontrôle de l'installation existante réussi en PowerShell 32 bits.
- Installateur 4.1.1 construit et relancé à la demande de l'utilisateur : 142994438 octets, SHA256 `a33146dc47a082f3a52847e4d5c25be0fe7791653e4ae0fe94d52e16bb50a3bc`. La fin de l'assistant et l'autorisation administrateur restent sous le contrôle de l'utilisateur.

## Correctif préparation des données du 9 novembre 2026

- L'installateur 4.1.1 est bien élevé mais échoue avant de créer les données et leur journal. Diagnostic administrateur dans un ProgramData temporaire : `Initialize-ServiceData` fonctionne directement, puis devient introuvable via le point d'entrée de gestion. Le chargement forcé de ServiceData à l'intérieur d'InstallSecurity retire ses exports de la portée appelante.
- Suppression du rechargement forcé imbriqué ; les deux modules partagent l'instance déjà chargée. Régression observée en échec puis validée pour la coexistence des fonctions de migration et des dépendances ACL de sécurité.
- Ajout de deux tests d'intégration administrateur opt-in, réellement exécutés avec données synthétiques : PowerShell 32 et 64 bits, création initiale, migration, seconde préparation avec logs imbriqués, conservation exacte des réglages, du secret et du SID. Aucun accès aux vrais jetons ni modification des réglages privés.
- Version de correctif 4.1.2 ; revue ciblée de toute la suite d'installation avant reconstruction finale.
- Suite courante : 351 tests réussis, aucun échec ; les deux tests administrateur opt-in sont ignorés dans la suite ordinaire et ont été exécutés séparément, tous deux réussis. Build Vite validé.
- Revue indépendante ciblée : aucun blocage concret restant dans le chemin normal d'installation/mise à jour ; 18 vérifications ciblées supplémentaires réussies. L'enregistrement SCM réel reste sous le contrôle de l'assistant d'installation, hors des tests synthétiques.
- Installateur 4.1.2 construit : 142994797 octets, SHA256 `51c9cdc4aa37016d5ba52e4082e29d863449b449163a4fb3f65b54b9751b2134`. Les trois scripts de gestion empaquetés correspondent exactement aux sources testées ; 232 fichiers du moteur conformes au manifeste. Copie isolée démarrée avec le Node embarqué : version 4.1.2, contrôle HTTPS, API publique et arrêt propre validés, sans impression.
- Nouvel installateur relancé. Préparation des données confirmée sur le poste par `Machine data prepared; any existing settings were preserved.` dans le journal machine ; le blocage rapporté est levé. La suite de l'assistant est laissée à l'utilisateur ; surveillance en lecture de l'état du service.
- Installation réelle terminée avec l'utilisateur : journal `Service installed or updated; companion login entry registered.`. Vérification en lecture du SCM : `SmartEatPrinterAgent` Running, démarrage Auto sous LocalSystem, automatique différé et reprise après panne configurés. Contrôle HTTPS authentifié : moteur 4.1.2 actif et compagnon connecté ; API publique `/test` disponible. Aucun ticket de test physique envoyé et aucun redémarrage machine effectué.
