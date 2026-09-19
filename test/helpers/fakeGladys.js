// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishCameraImage             -> record calls so tests can assert them
//   - publishTransports              -> record calls so tests can assert them
//   - setConnectionStatus            -> record calls so tests can assert them
// This lets us test the pure "wiring" logic (discovery payloads, dispatch)
// without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

export function createFakeGladys() {
  const published = [];
  const cameraImages = [];
  const transports = [];
  const connectionStatuses = [];

  return {
    published,
    cameraImages,
    transports,
    connectionStatuses,

    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        // Reproduit la validation réelle du cœur Gladys (saveStates.js) :
        // "state" numérique OU "text" chaîne, jamais l'un à la place de
        // l'autre. Sans ce garde-fou, un bug comme `state: String(x)` sur
        // une feature texte passerait les tests en silence et ne serait
        // découvert qu'au déploiement contre une vraie instance Gladys.
        const hasNumericState = typeof s.state === 'number' && Number.isFinite(s.state);
        const hasText = typeof s.text === 'string';
        if (!hasNumericState && !hasText) {
          throw new Error(
            `publishStates: ${s.device_feature_external_id} doit avoir un "state" numérique ou un "text" chaîne`,
          );
        }
        published.push({
          featureExternalId: s.device_feature_external_id,
          state: s.state,
          text: s.text,
        });
      }
    },

    async publishCameraImage(deviceExternalId, image) {
      cameraImages.push({ deviceExternalId, image });
    },

    async publishTransports(entries) {
      transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },
  };
}
