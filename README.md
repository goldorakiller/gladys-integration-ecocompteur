# Écocompteur Legrand — intégration Gladys Assistant

[![CI](https://github.com/goldorakiller/gladys-integration-ecocompteur/actions/workflows/ci.yml/badge.svg)](https://github.com/goldorakiller/gladys-integration-ecocompteur/actions/workflows/ci.yml)
[![Image GHCR](https://img.shields.io/badge/ghcr.io-gladys--integration--ecocompteur-blue)](https://github.com/goldorakiller/gladys-integration-ecocompteur/pkgs/container/gladys-integration-ecocompteur)
[![Licence Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-informational)](LICENSE)

Intégration externe [Gladys Assistant](https://gladysassistant.com) pour l'**écocompteur Legrand** (réf. 412000). Elle lit l'appareil en HTTP sur votre réseau local — aucun compte, aucun cloud, aucune clé d'API — et publie ses mesures comme des appareils Gladys normaux.

<p align="center"><img src="cover.png" alt="Écocompteur Legrand" width="500"></p>

## Ce que ça publie dans Gladys

- La **puissance instantanée des 5 tores**, avec les libellés que vous avez saisis sur l'écocompteur lui-même (pas de renommage à refaire côté Gladys).
- Les **index téléinformation** (heures creuses / heures pleines, Tempo, ou index Base), en kWh — l'option tarifaire est détectée automatiquement sur l'appareil.
- Les **entrées à impulsions** (gaz, eau) réellement activées sur l'écocompteur, en volume (m³).
- Le tarif en cours, l'option tarifaire et l'intensité souscrite, à titre indicatif.

Rien n'est codé en dur : adresse, tarif, câblage et libellés viennent tous de votre propre appareil. Voir la [documentation complète](docs/fr.md) pour le détail de la configuration.

## Prérequis

- Un écocompteur Legrand 412000 accessible en HTTP sur le réseau local (`/inst.json` et `/data.json`).
- Un **bail DHCP fixe** pour cet appareil, recommandé : son adresse IP sert d'identifiant unique côté Gladys.
- Gladys Assistant ≥ 4.86.0.

## Installation

Une fois le dépôt indexé par le catalogue Gladys (le topic GitHub `gladys-assistant-integration` est posé), l'intégration est installable en un clic depuis **Intégrations → Store** dans Gladys. En attendant l'indexation, ou pour tester une version précise, elle s'installe aussi manuellement en **mode développeur** :

1. Ouvrez [Intégrations → Installer depuis GitHub → Mode développeur](https://gladysassistant.com) dans Gladys.
2. Renseignez l'image Docker `ghcr.io/goldorakiller/gladys-integration-ecocompteur:1.0.0` (ou `:latest`).
3. Collez le [manifest](gladys-assistant-integration.json) de ce dépôt dans le champ prévu.

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
npm test               # tests unitaires (node --test)
npm run lint            # ESLint
npm run format          # Prettier

# Sonde le matériel réel sans passer par Gladys ni Docker :
ECO_HOST=192.168.1.140 npm run probe
```

Pour lancer l'intégration hors conteneur, contre une instance Gladys :

```bash
GLADYS_HOST_API_URL=http://192.168.1.63 \
GLADYS_INTEGRATION_TOKEN=<jeton fourni par Gladys> \
GLADYS_INTEGRATION_SELECTOR=ecocompteur-legrand \
LOG_LEVEL=debug \
npm start
```

Construite sur le [template officiel JavaScript](https://github.com/GladysAssistant/integration-template-js) et le [SDK](https://github.com/GladysAssistant/integration-sdk-js) `@gladysassistant/integration-sdk`.

## Publier une nouvelle version

Depuis GitHub : **Actions → Release → Run workflow**, choisir `patch`/`minor`/`major`. Le workflow bumpe la version (`package.json` + manifest), pousse le tag `vX.Y.Z` et publie l'image multi-arch (`linux/amd64` + `linux/arm64`) sur `ghcr.io`.

## Licence

Apache-2.0
