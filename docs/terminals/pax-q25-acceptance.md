# Recette materielle PAX Q25

Cette fiche valide uniquement les combinaisons reellement activees dans l'application de paiement du terminal. Une connexion TCP ou l'ouverture d'un port COM ne suffit pas: le test de connexion doit recevoir une reponse protocolaire valide.

Ne jamais inscrire dans ce document un PAN, un ticket commercant complet, un jeton, une cle, un identifiant commercant reel ou une trame brute.

## Informations de session

| Champ | Valeur |
| --- | --- |
| Date | A renseigner |
| Operateur | A renseigner |
| Version SmartEat Printer Agent | A renseigner |
| Modele / numero de serie | PAX Q25 / ne pas consigner le numero complet |
| Application de paiement / version | A renseigner depuis le TPE |
| Acquereur / mainteneur | A renseigner sans secret |

## Matrice de compatibilite

Statuts autorises: `non execute`, `non provisionne`, `echec`, `valide`.

| Protocole | Transport | Statut | Version application | Reglage TPE | Liaison locale |
| --- | --- | --- | --- | --- | --- |
| Caisse-AP | TCP/IP | non execute | A renseigner | Concert V3 / port caisse | IP et port a renseigner |
| Caisse-AP | USB / COM | non execute | A renseigner | Concert V3 / liaison serie | Pilote et COM a renseigner |
| Nepting | TCP/IP | non execute | A renseigner | Nepting local TLV | IP et port a renseigner |
| Nepting | USB / COM | non execute | A renseigner | Nepting local TLV | Pilote et COM a renseigner |

Marquer `non provisionne` lorsqu'une combinaison n'est pas exposee par l'application du Q25. Ne pas modifier le provisionnement du terminal dans le cadre de cette recette.

## Checklist par combinaison

Dupliquer cette section pour chaque ligne de la matrice dont le statut n'est pas `non provisionne`.

### Configuration

- [ ] Relever l'application de paiement et sa version.
- [ ] Confirmer le protocole configure: Caisse-AP ou Nepting.
- [ ] Confirmer le transport configure: TCP/IP ou USB serie.
- [ ] Pour TCP/IP, relever l'IP locale et le port sans les publier hors du poste.
- [ ] Pour USB, relever le pilote Windows et le port COM.
- [ ] Verifier le numero de caisse et l'identifiant caisse avec le mainteneur.
- [ ] Saisir l'identifiant commercant Nepting uniquement dans l'application, jamais ici.

### Echanges

- [ ] Le bouton **Tester** renvoie `TPE verifie` apres une reponse protocolaire.
- [ ] Un paiement de faible montant autorise atteint l'etat `Paiement accepte` une seule fois.
- [ ] Un refus reel atteint l'etat `Paiement refuse` sans nouvelle tentative automatique.
- [ ] Un abandon par le client atteint `Paiement annule` si le TPE fournit une reponse definitive.
- [ ] Une coupure apres envoi produit `Resultat a verifier`, jamais un nouvel envoi automatique.
- [ ] Le journal du TPE permet de rapprocher le resultat ambigu avec l'identifiant de transaction SmartEat.

### Redemarrage et rapprochement

- [ ] Redemarrer l'agent avec une transaction terminale enregistree et confirmer qu'elle reste consultable.
- [ ] Redemarrer apres un resultat `unknown` et confirmer qu'aucun paiement n'est renvoye.
- [ ] Comparer le montant, l'heure et la reference non sensible avec le journal du terminal.
- [ ] Confirmer qu'aucun PAN, ticket complet, jeton ou trame brute n'apparait dans `settings.json`, l'API ou `agent-debug.log`.

## Resultat

| Champ | Valeur |
| --- | --- |
| Statut final | non execute / non provisionne / echec / valide |
| Transaction de test | Identifiant SmartEat non sensible |
| Anomalie observee | Aucune ou description sans donnee sensible |
| Action requise | Aucune ou intervention du mainteneur |
| Validation | Initiales et date |

## Etat de la recette initiale

La recette materielle n'a pas ete executee pendant l'implementation: aucun acces controle au PAX Q25 ni a son application de paiement n'etait disponible dans la session. Les quatre combinaisons restent donc `non execute` jusqu'a une verification sur le terminal reel.
