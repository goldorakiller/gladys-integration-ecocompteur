# Écocompteur Legrand

Cette intégration lit l'écocompteur Legrand (réf. 412000) directement sur votre réseau local, sans compte ni service tiers. L'appareil expose deux endpoints HTTP (`/inst.json` et `/data.json`) que l'intégration interroge à intervalle régulier.

## Ce qui remonte dans Gladys

- **Puissance instantanée des 5 tores**, en watts. Les features reprennent les libellés que vous avez saisis dans l'interface de l'écocompteur : si votre entrée 1 s'appelle « Chauffage », elle s'appelle « Chauffage » dans Gladys.
- **Index du compteur** issus de la téléinformation : heures creuses et heures pleines, index Tempo (6 couleurs) ou index base selon votre option tarifaire (détectée automatiquement). En kWh.
- **Option tarifaire** et **Tarif en cours** en texte lisible (« HC/HP », « Tempo », « Heure Pleine Bleu »...) plutôt qu'en code numérique brut.
- **Entrées à impulsions** (gaz, eau) : seules celles activées dans l'écocompteur sont créées, avec leur volume en m³.

## Suivi de consommation et coût (option Tempo)

Chaque index créé (heures creuses, heures pleines, ou l'une des 6 combinaisons Tempo) est une véritable feature « Index » Gladys : le cœur Gladys y ajoute automatiquement une feature « Consommation 30 minutes » et une feature « Coût 30 minutes », sans rien à faire côté configuration de l'intégration — seule une grille tarifaire dans Paramètres → Énergie est nécessaire pour que le coût se calcule.

En option Tempo, ça donne **6 index distincts**, chacun avec son propre suivi consommation/coût :

| Index                      | Période                    |
| -------------------------- | -------------------------- |
| Index Heures Creuses Bleu  | Heures creuses, jour bleu  |
| Index Heures Pleines Bleu  | Heures pleines, jour bleu  |
| Index Heures Creuses Blanc | Heures creuses, jour blanc |
| Index Heures Pleines Blanc | Heures pleines, jour blanc |
| Index Heures Creuses Rouge | Heures creuses, jour rouge |
| Index Heures Pleines Rouge | Heures pleines, jour rouge |

Gladys connaît lui-même le calendrier officiel des jours Tempo : il n'a pas besoin de l'écocompteur pour savoir quelle couleur s'applique quel jour, seulement des prix associés à chaque combinaison couleur/créneau.

## Configuration

1. Donnez à votre écocompteur un bail DHCP fixe sur votre box. Son adresse sert d'identifiant : la changer créerait un nouvel appareil dans Gladys.
2. Saisissez cette adresse dans le champ prévu (par exemple `192.168.1.140`).
3. Ajustez l'intervalle de rafraîchissement si besoin (60 secondes par défaut, de 1 seconde à 60 secondes).
4. Utilisez le bouton **Tester la connexion** pour vérifier que l'appareil répond avant de lancer la découverte.

## Remarques

- L'écocompteur renvoie ses index avec des zéros en tête, ce qui n'est pas du JSON valide ; l'intégration normalise la réponse avant de la parser.
- Les libellés des tores sont relus à chaque découverte : renommer une entrée dans l'écocompteur puis relancer une découverte met à jour les noms dans Gladys.
- Un tore non câblé renvoie 0 W en permanence. Vous pouvez supprimer la feature correspondante dans Gladys si elle vous encombre.
