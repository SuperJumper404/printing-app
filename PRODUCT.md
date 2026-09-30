# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Les restaurateurs et responsables de point de vente utilisent l'application de bureau sur le poste de caisse pour configurer et exploiter leurs peripheriques locaux.

## Product Purpose

SmartEat Printer Agent relie la caisse SmartEat aux imprimantes et terminaux de paiement presents sur le reseau local ou branches au poste. Le succes signifie qu'un operateur peut configurer, verifier et utiliser ces appareils sans manipuler leurs protocoles techniques au quotidien.

## Operating Context

L'application Electron reste ouverte sur un poste Windows de caisse. Les appareils sont configures localement, puis utilises par l'interface embarquee ou par l'agent HTTP local.

## Capabilities and Constraints

- Les imprimantes locales utilisent plusieurs transports deja presents dans le produit.
- Les TPE locaux ciblent d'abord le PAX Q25 avec Caisse-AP ou Nepting, sur TCP/IP ou port serie USB virtuel.
- Stripe et les TPE cloud sont hors du perimetre actuel.
- Les montants de paiement sont des entiers en centimes et la premiere version accepte uniquement EUR.
- La configuration TPE est modifiable uniquement depuis Electron; l'API HTTP locale exige la session SmartEat enregistree.
- Une ouverture de port ne prouve pas la compatibilite: seul un echange protocolaire valide confirme le TPE.

## Brand Commitments

Le produit conserve le nom SmartEat Printer Agent et une voix operationnelle, concise et en francais.

## Evidence on Hand

Le depot contient l'interface Vue existante, les flux d'impression et le cahier de conception du module TPE dans `docs/superpowers/specs/2026-09-30-local-payment-terminals-design.md`. Aucun argument commercial ni mesure de performance ne doit etre invente.

## Product Principles

- Rendre l'etat reel du materiel visible sans faux positif.
- Proteger chaque paiement contre les doubles envois et les resultats ambigus.
- Garder les reglages techniques accessibles sans encombrer le travail courant.
- Ne jamais exposer les donnees sensibles du terminal dans l'interface ou les journaux.
