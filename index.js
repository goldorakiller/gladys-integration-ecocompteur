// -----------------------------------------------------------------------------
// Point d'entrée de l'intégration externe « Écocompteur Legrand ».
//
// Ce fichier ne contient aucune logique matérielle : il câble le SDK au
// catalogue d'appareils (src/devices/). Il se contente de :
//   1. instancier le SDK (connexion, auth, reconnexion : gérées pour vous) ;
//   2. enregistrer les handlers AVANT connect() ;
//   3. rafraîchir les métadonnées de l'appareil puis publier la découverte.
//
// Variables d'environnement injectées par le superviseur Gladys :
//   - GLADYS_HOST_API_URL
//   - GLADYS_INTEGRATION_TOKEN
//   - GLADYS_INTEGRATION_SELECTOR
// Le SDK les lit automatiquement : `new GladysIntegration()` suffit.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { fetchMetadata } from './src/ecocompteur.js';
import { setMetadata } from './src/devices/ecocompteur.js';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  findBlueprintByDevice,
} from './src/devices/index.js';

const gladys = new GladysIntegration();

// Configuration courante (rechargée à chaud via onConfigUpdated).
let config = normalizeConfig();

/**
 * Relit les libellés et l'option tarifaire sur l'écocompteur, puis publie les
 * appareils. `publishDiscoveredDevices` est idempotent (upsert par external_id),
 * donc cette fonction peut être rappelée à chaque reconnexion ou changement de
 * configuration sans créer de doublon.
 */
async function refreshAndPublishDevices() {
  if (!config.host) {
    logger.warn('Aucune adresse configurée : découverte reportée.');
    return;
  }
  setMetadata(await fetchMetadata(config.host));
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
}

// --- Découverte : Gladys demande la liste des appareils ----------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publication des appareils découverts');
  await refreshAndPublishDevices();
});

// --- Polling : Gladys demande de rafraîchir un appareil ----------------------
gladys.onPoll(async (device) => {
  const blueprint = findBlueprintByDevice(gladys, device, config);
  if (!blueprint || typeof blueprint.onPoll !== 'function') {
    logger.debug(`onPoll ignoré pour ${device.external_id}`);
    return;
  }
  await blueprint.onPoll(gladys, config);
});

// --- Actions du manifest : boutons de l'écran de configuration ---------------
for (const blueprint of DEVICE_BLUEPRINTS) {
  for (const [actionKey, handler] of Object.entries(blueprint.actions ?? {})) {
    gladys.onAction(actionKey, (fields) => handler(gladys, { fields, config }));
  }
}

// --- Configuration modifiée par l'utilisateur --------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> nouvelle configuration reçue');
  config = normalizeConfig(newConfig);
  try {
    await refreshAndPublishDevices();
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Échec après changement de configuration', err);
    await reportFailure(err);
  }
});

// --- Cycle de vie de la connexion --------------------------------------------
gladys.on('connected', async () => {
  try {
    // 1) Récupérer la configuration saisie par l'utilisateur.
    config = normalizeConfig(await gladys.getConfig());

    // 2) (Re)publier les appareils dès que possible.
    await refreshAndPublishDevices();

    // 3) Statut applicatif affiché dans l'écran de configuration : distinct de
    //    l'état du conteneur — l'intégration peut tourner sans joindre
    //    l'écocompteur.
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Initialisation post-connexion échouée', err);
    await reportFailure(err);
  }
});

async function reportFailure(err) {
  await gladys
    .setConnectionStatus(false, {
      en: `Eco-meter unreachable: ${err.message}`,
      fr: `Écocompteur injoignable : ${err.message}`,
    })
    .catch(() => {});
}

// --- Arrêt propre -------------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Signal ${signal} reçu -> arrêt propre`);
});

// --- Démarrage ----------------------------------------------------------------
logger.info("Démarrage de l'intégration Écocompteur Legrand...");
gladys.connect().catch((err) => {
  logger.error('Connexion initiale échouée', err);
  process.exit(1);
});
