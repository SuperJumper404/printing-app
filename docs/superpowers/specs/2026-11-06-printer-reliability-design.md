# Fiabilité des imprimantes

Demande autorisée : corriger les défauts diagnostiqués, conserver l'envoi sur tous les protocoles activés successivement, ajouter les favoris en tête et corriger les caractères affichés.

## Comportement

- Une file par imprimante physique sérialise tickets, tests et ouverture du tiroir ; les différentes imprimantes restent indépendantes.
- Tous les protocoles activés sont essayés dans l'ordre existant, même après un succès ou un échec. Le résultat distingue succès, succès partiel, erreur et résultat incertain.
- Les erreurs transitoires avant transmission sont retentées trois fois au total, avec attente croissante. Les erreurs de configuration et les envois potentiellement déjà transmis ne sont pas rejoués automatiquement.
- Les ports série sont de vrais COM Windows ; USB001, WSD et les ports réseau ne deviennent pas des ports série.
- Les favoris et préférences persistent. Les favoris apparaissent en premier, restent visibles hors ligne et retrouvent leurs coordonnées détectées sans perdre leur identité.
- Les recherches périodiques détectent les nouveaux appareils sans écraser les modifications de l'utilisateur. Un appareil détecté n'est pas nécessairement compatible ou accessible.
- La recherche réseau prend en compte toutes les interfaces IPv4 utiles et mDNS, sans hypothèse 192.x ou masque /24.
- L'identité USB/Bluetooth doit être non ambiguë ; le Bluetooth classique n'est pas assimilé à GATT. Les autorisations et services GATT nécessaires sont explicites.
- Tous les transports ont une fin bornée, libèrent leurs ressources et signalent correctement les écritures partielles et erreurs constructeur. L'expiration du pont annule l'opération et empêche un nouvel envoi concurrent tant que la précédente n'est pas terminée.
- La récupération des tickets ne dépend plus de la navigation dans l'interface et possède un délai réseau.
- Les erreurs visibles sont courtes et en français ; les détails techniques restent disponibles pour le diagnostic sans afficher une commande PowerShell entière.
- Les accents de l'interface et le texte imprimé sont préservés ; les données binaires ESC/POS ne sont pas transcodées aveuglément.

## Approche

Renforcer les modules existants et ajouter de petits services testables. Le remplacement général par COM virtuel est écarté car il ne corrige pas les erreurs d'identification et ne convient pas à tous les périphériques. Un service Windows séparé et une refonte générale de l'application ne sont pas nécessaires à ce correctif.

## Contraintes

Pas de lecture exposée, modification ou commit de settings.json et des jetons réels. Pas d'impression réelle pendant les tests. Pas de publication ni de changement des TPE. Compatibilité avec les anciens réglages et les dix transports existants.
