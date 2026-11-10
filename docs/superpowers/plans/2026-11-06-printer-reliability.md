# Printer Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:dispatching-parallel-agents to implement these independent domains with regression tests before fixes.

**Goal:** Fiabiliser les impressions sur tous les transports, conserver les favoris en tête et corriger l'affichage français.

**Architecture:** Garder les transports existants, ajouter une coordination par imprimante et des reprises bornées. Séparer préférences durables, observation actuelle et erreurs de transport.

**Tech Stack:** Electron, Node.js, Vue 3, node:test.

**Spec:** docs/superpowers/specs/2026-11-06-printer-reliability-design.md

## Global Constraints

- Tous les protocoles activés restent utilisés successivement, même si plusieurs tickets sortent.
- Trois tentatives maximum par transport pour les erreurs transitoires explicitement antérieures à l'envoi.
- Pas de modification de settings.json, de jetons réels, de publication ou d'impression physique.
- Préserver les dix transports et les configurations anciennes ; ne pas modifier les TPE.
- Favoris persistants en tête ; état hors ligne distinct de la préférence conservée.

## Review Focus

- Deux tickets et un test simultanés vers le même périphérique : aucun chevauchement.
- Rebranchement avec changement COM/IP : nouvelles coordonnées, anciennes préférences.
- Deux périphériques de même modèle/nom : erreur d'ambiguïté plutôt que mauvaise destination.
- Expiration pendant un envoi : ressource libérée, aucun faux succès ni rejeu incontrôlé.
- Français accentué et commandes ESC/POS binaires : affichage et octets préservés.

### Task 1: Découverte, préférences et favoris

Files: lib/printers/{deviceModel,configMigration,correlateDevices,discovery/windows}.js ; src/printers/transportPresentation.mjs ; src/views/PrintersView.vue ; tests associés.
Produces: favorite boolean, sortPrinters(), merge conservant identité et préférences avec coordonnées actualisées. Nouvelle découverte réseau dans un module testable si nécessaire ; intégration index.js par le contrôleur.
- [x] Écrire et observer les échecs COM invalide, favoris triés/persistants, nouveau COM/IP, périphérique absent et compatibilité réelle.
- [x] Implémenter les correctifs et recherche périodique sans écrasement concurrent.
- [x] Exécuter les tests ciblés puis transmettre les besoins d'intégration.

### Task 2: Cycle de vie USB, HID, Bluetooth et pont

Files: src/printers/web*Transport.js ; src/deviceBridge.js ; lib/printers/{deviceBridgeClient,bluetoothGattConfig}.js ; tests associés.
Interfaces: send(..., {signal}={}); client.request(operation,payload,timeoutMs,{signal}={}); erreurs avec code, retryable et deliveryState ('not-sent' ou 'unknown').
- [x] Reproduire les ambiguïtés, écritures partielles, autorisations GATT, coupures et annulations tardives.
- [x] Corriger sélection, validation des services et nettoyage/annulation avec transmission des erreurs structurées.
- [x] Vérifier les tests et documenter les limites liées aux pilotes et autorisations.

### Task 3: Transports réseau et Windows

Files: lib/printers/transports/*.js ; lib/printers/errors.js ; tests associés.
Interfaces: send({printer,transport,transportId,base64Data,xmlData,signal}); erreurs avec code, retryable, deliveryState, action. Export formatPrintError(error) pour messages français sûrs.
- [x] Tests en échec pour COM invalide, TCP fermé prématurément, délais IPP/ePOS, réponses ePOS négatives et nettoyage Windows.
- [x] Ajouter bornes, annulation, classification d'erreurs et validation ePOS.
- [x] Vérifier les tests ciblés et conserver les données binaires.

### Task 4: Coordination, intégration et caractères

Files: lib/printers/dispatch.js ; nouveaux services polling/coordination ; index.js ; src/views/PrintingView.vue ; texte de l'interface restant ; tests associés.
Consumes: contrats des tâches 1-3.
- [x] Tests en échec pour ordre des protocoles, exclusion entre jobs, reprises bornées, résultats partiels et polling indépendant des vues.
- [x] Implémenter et intégrer tous les envois dans la même coordination, déplacer le polling et actualiser l'historique.
- [x] Corriger l'encodage des libellés et protéger accents et octets binaires par tests utiles.
- [x] Exécuter npm.cmd run verify, relire le diff complet, effectuer une revue indépendante et corriger les défauts importants.

## Execution record

- Le correctif complet est explicitement demandé après le diagnostic ; exécution continue dans la branche codex/printer-reliability du dossier utilisateur, sans création de worktree supplémentaire.

## Validation finale

- `npm.cmd run verify` : 260 tests réussis, syntaxe du processus principal et compilation frontend validées.
- Tests de régression observés en échec avant correction pour coordination, ports, découverte, favoris, identités, annulation et encodage.
- Revue indépendante : conformité et qualité validées, aucun défaut critique ou important restant. Cas DHCP complet et découverte mDNS asynchrone reproduits après correction.
- Interface Electron avec données simulées : favori en tête, accents dans l’historique et rendu bureau/fenêtre étroite vérifiés sans accès matériel.
- Sortie UTF-8 de PowerShell vérifiée avec du texte accentué, sans impression.
- Réglages privés non modifiés ; aucune publication, impression physique ou modification des TPE.
