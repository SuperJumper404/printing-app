# Organisation des cartes imprimantes

Spec : `docs/superpowers/specs/2026-11-09-printer-list-organization-design.md`.

- [x] Ajouter les régressions pour persistance et fusion des états masqué/replié, filtrage avec favoris et maintien des impressions d'une imprimante masquée.
- [x] Normaliser les préférences dans le modèle et leur fusion avec les détections.
- [x] Ajouter les contrôles des cartes et des vues, les états vides, l'accès clavier et la disposition en fenêtre étroite.
- [x] Vérifier les tests, la compilation, et le parcours réel Electron sur données synthétiques sans matériel.
- [x] Construire un installateur à jour et effectuer une revue ciblée.

## Exécution

- Masquage d'affichage seul confirmé par l'utilisateur. Modèle, fusion des détections et filtres visibles/masquées implémentés ; les protocoles restent indépendants du masquage.
- Régressions observées en échec puis validées : préférences conservées après changement de port/déconnexion, tri des favoris dans chaque vue et route d'impression encore active pour une imprimante masquée.
- Le test Electron avec rechargement immédiat a exposé des réponses de lecture anciennes après une sauvegarde. Attente des sauvegardes et contrôle de révision ajoutés aux lectures IPC et aux notifications du compagnon ; régressions asynchrones RED puis GREEN.
- Parcours réel Electron sur service et données synthétiques : déplier/replier, masquer/réafficher, changer de vue et recharger, préférences persistées. Captures bureau et fenêtre étroite vérifiées, aucun débordement des cartes. Aucun envoi matériel. Détecteur visuel mécanique : aucun signalement.
- Version destinée à la distribution locale : 4.2.0. Le service 4.1.2 installé continue de fonctionner pendant les vérifications.
- Validation finale du code : 356 tests réussis, aucun échec ; deux tests administrateur opt-in non exécutés par la suite courante. Syntaxe des processus principaux et compilation Vite validées. Revue indépendante de la correction de concurrence : aucun blocage restant.
- Parcours Electron supplémentaire : tout déplier/tout replier, toutes les cartes masquées, accès à la vue Masquées depuis l'état vide, puis réaffichage. Tout fonctionne sur données synthétiques, sans écriture matérielle.
- Installateur local construit sans publication : `dist6/SmartEat Printer Agent Setup 4.2.0.exe`, 142996884 octets, SHA256 `b45e03e2d28a1a784a0ece266c844dbca6c58c6517725d03d78a3ba1a99777ea`.
- Paquet vérifié : les sources du compagnon et des préférences correspondent à l'archive ASAR ; 232 fichiers du moteur conformes au manifeste. Moteur empaqueté 4.2.0 copié hors du projet, démarrage autonome avec Node embarqué, contrôle HTTPS/API et arrêt propre validés. La 4.2.0 n'est pas installée automatiquement sur le poste.
