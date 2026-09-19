# gladys-integration-ecocompteur

Intégration externe [Gladys Assistant](https://gladysassistant.com) pour l'**écocompteur Legrand** (réf. 412000), construite sur le template officiel et le SDK JavaScript.

Elle interroge l'appareil en HTTP sur le réseau local et publie dans Gladys :

- la puissance instantanée des 5 tores (W), nommés d'après les libellés de l'écocompteur ;
- les index téléinfo HC/HP ou Base (kWh), selon l'option tarifaire détectée ;
- les entrées à impulsions activées (gaz, eau), en volume (m³).

## Structure

```
index.js                              câblage du SDK (handlers, cycle de vie)
src/config.js                         valeurs par défaut + normalisation
src/ecocompteur.js                    client HTTP (inst.json, data.json, parsing)
src/devices/ecocompteur.js            déclaration des features + polling
src/devices/index.js                  registre des types d'appareils
gladys-assistant-integration.json     manifest (config_schema, actions, image)
docs/fr.md, docs/en.md                documentation affichée dans Gladys
test/                                 tests unitaires (node --test)
```

## Développement

```bash
npm install
npm test        # 10 tests, dont un polling complet sur des réponses réelles
npm run lint
npm run format
```

Pour lancer l'intégration hors conteneur, contre une instance Gladys :

```bash
GLADYS_HOST_API_URL=http://192.168.1.63 \
GLADYS_INTEGRATION_TOKEN=<jeton fourni par Gladys> \
GLADYS_INTEGRATION_SELECTOR=ecocompteur-legrand \
LOG_LEVEL=debug \
npm start
```

## Publication

1. Remplacer `REPLACE_ME` dans `gladys-assistant-integration.json` par le compte GitHub propriétaire du dépôt.
2. Ajouter une image `cover.png` (800×534 px max, 150 Ko max) à la racine.
3. Ajouter le topic GitHub `gladys-assistant-integration` au dépôt.
4. Lancer le workflow de release : il bumpe la version, crée le tag et publie l'image multi-arch sur GHCR.

L'indexeur Gladys découvre les dépôts portant ce topic, valide le manifest et rend l'intégration visible dans le catalogue de toutes les instances, en général dans l'heure.

## Licence

Apache-2.0
