// -----------------------------------------------------------------------------
// Configuration de l'intégration.
//
// Elle est saisie par l'utilisateur dans Gladys, à partir du `config_schema`
// déclaré dans `gladys-assistant-integration.json`. Le SDK la récupère
// (`gladys.getConfig()`) et notifie chaque changement (`onConfigUpdated`).
// Ce module ne fait que donner les valeurs par défaut et normaliser les types :
// le reste du code ne manipule jamais d'`undefined`.
// -----------------------------------------------------------------------------

// Ces valeurs doivent rester cohérentes avec les `default` du manifest.
export const DEFAULT_CONFIG = {
  host: '',
  poll_frequency: 60, // secondes
  publish_indexes: true, // index téléinfo (HC/HP ou Base)
};

// Le cœur Gladys n'accepte qu'un enum fermé pour `device.poll_frequency`
// (DEVICE_POLL_FREQUENCIES, en millisecondes) : 1/2/10/15/30/60 s. Le
// `config_schema` du manifest expose déjà ces 6 valeurs en `select`, donc
// l'utilisateur ne peut pas en choisir d'autres — mais on reste défensif ici
// (config d'une version antérieure du manifeste encore stockée, etc.).
const ALLOWED_POLL_FREQUENCIES_SECONDS = [1, 2, 10, 15, 30, 60];

/** Valeur autorisée la plus proche de `value` (secondes). */
function nearestAllowedPollFrequency(value) {
  return ALLOWED_POLL_FREQUENCIES_SECONDS.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest,
  );
}

/**
 * Fusionne la configuration utilisateur avec les valeurs par défaut.
 * @param {Record<string, unknown>} raw configuration renvoyée par le SDK
 */
export function normalizeConfig(raw = {}) {
  const pollFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    host: String(raw.host ?? DEFAULT_CONFIG.host).trim(),
    poll_frequency: Number.isFinite(pollFrequency)
      ? nearestAllowedPollFrequency(pollFrequency)
      : DEFAULT_CONFIG.poll_frequency,
    publish_indexes: raw.publish_indexes !== false,
  };
}
