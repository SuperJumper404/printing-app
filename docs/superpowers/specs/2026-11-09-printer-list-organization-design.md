# Organisation de la liste des imprimantes

Demande : replier/déplier les cartes et masquer les périphériques inutiles pour trier une liste de découverte. L'utilisateur confirme que masquer ne doit pas modifier les impressions.

- Chaque carte garde son nom, son état, son adresse, les favoris et ses actions visibles ; ses détails se replient via un bouton accessible au clavier. Les cartes démarrent repliées, choix de présentation pris pour faciliter le tri.
- Masquer retire une carte de la vue principale. Une vue « Masquées » avec compteur permet de la retrouver et de la réafficher. Les favoris restent en tête dans chaque vue.
- Les deux préférences sont enregistrées sur l'identité persistante de l'imprimante ; rafraîchissement, débranchement, changement de COM/IP et redémarrage les conservent.
- Masquer est une préférence d'affichage. Les protocoles activés et le routage des tickets restent indépendants.
- L'interface Vue et le style existants sont conservés. Pas de nouvelle dépendance, de suppression de périphérique ni d'impression physique de test.

Approche retenue : deux champs de présentation persistants, normalisés et fusionnés avec les préférences existantes. Un état local seul ne résisterait pas au redémarrage ; désactiver les transports contredirait le choix explicite de l'utilisateur.
