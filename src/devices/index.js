// -----------------------------------------------------------------------------
// Registre des appareils.
//
// Un seul type ici (l'écocompteur), mais la structure du template est conservée
// pour rester extensible : chaque type d'appareil expose la même forme.
//   - key                                : identifiant court (logs)
//   - deviceExternalId(gladys, config)   : external_id de l'appareil
//   - buildDevice(gladys, config)        : charge utile de découverte
//   - onPoll(gladys, config)  (optionnel): lecture périodique
//   - actions                 (optionnel): handlers des actions du manifest
// -----------------------------------------------------------------------------

import { ecocompteur } from './ecocompteur.js';

export const DEVICE_BLUEPRINTS = [ecocompteur];

/** Charge utile de découverte pour Gladys (tous les appareils). */
export function buildDiscoveredDevices(gladys, config) {
  return DEVICE_BLUEPRINTS.map((bp) => bp.buildDevice(gladys, config));
}

/** Retrouve le blueprint propriétaire d'un appareil, à partir de son external_id. */
export function findBlueprintByDevice(gladys, device, config) {
  return DEVICE_BLUEPRINTS.find((bp) => bp.deviceExternalId(gladys, config) === device.external_id);
}
