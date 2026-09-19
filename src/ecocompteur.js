// -----------------------------------------------------------------------------
// Client HTTP de l'écocompteur Legrand.
//
// L'appareil expose deux endpoints locaux, sans authentification :
//   GET /inst.json  -> puissances instantanées des 5 tores + compteurs d'impulsions
//   GET /data.json  -> option tarifaire, index téléinfo, libellés des entrées
//
// Particularité : /data.json renvoie les index avec des zéros en tête
// ("conso_hc" : 012323332), ce qui n'est PAS du JSON valide et fait échouer
// JSON.parse. On normalise donc le texte avant parsing.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'ecocompteur-client' });

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Parse le JSON « approximatif » de l'écocompteur : les nombres à zéros en tête
 * (012323332) sont ramenés à une forme valide (12323332).
 * @param {string} text corps de la réponse
 */
export function parseEcocompteurJson(text) {
  return JSON.parse(text.replace(/:(\s*)0+(\d)/g, ':$1$2'));
}

/**
 * Construit l'URL de base à partir de l'hôte saisi par l'utilisateur.
 * Accepte "192.168.1.140", "192.168.1.140:80" ou "http://192.168.1.140".
 * @param {string} host
 */
export function baseUrl(host) {
  const trimmed = String(host || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) throw new Error("Aucune adresse d'écocompteur configurée");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function fetchJson(host, path, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl(host)}${path}`;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} sur ${path}`);
    }
    return parseEcocompteurJson(await response.text());
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`L'écocompteur n'a pas répondu en ${timeoutMs} ms (${url})`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Puissances instantanées et compteurs d'impulsions. */
export function fetchInstant(host, timeoutMs) {
  return fetchJson(host, '/inst.json', timeoutMs);
}

/** Index téléinfo, option tarifaire et libellés des entrées. */
export function fetchData(host, timeoutMs) {
  return fetchJson(host, '/data.json', timeoutMs);
}

// Exporté pour les tests unitaires.
export const internals = { tariffFromOption };

/**
 * Métadonnées utilisées pour construire l'appareil : les libellés viennent de
 * l'écocompteur lui-même, ce que l'utilisateur a saisi dans SON interface.
 * En cas d'échec, on retombe sur des libellés génériques : l'intégration doit
 * pouvoir se déclarer même si l'appareil est momentanément injoignable.
 *
 * @param {string} host
 * @returns {Promise<{circuits: Array<{key: string, field: string, name: string}>,
 *                    pulses: Array<{key: string, field: string, volumeField: string, name: string}>,
 *                    tariff: 'base' | 'hchp' | 'tempo'}>}
 */
export async function fetchMetadata(host) {
  let data = null;
  try {
    data = await fetchData(host);
  } catch (err) {
    logger.warn(`Libellés indisponibles, valeurs par défaut utilisées : ${err.message}`);
  }

  const circuits = [1, 2, 3, 4, 5].map((index) => ({
    key: `circuit${index}`,
    field: `data${index}`,
    name: data?.[`label_entree${index}`]?.trim() || `Circuit ${index}`,
  }));

  // Entrées à impulsions : seules celles activées dans l'écocompteur comptent.
  // data6/data6m3 correspondent à imp0, data7/data7m3 à imp1.
  const pulses = [0, 1]
    .filter((index) => data === null || data[`entree_imp${index}_disabled`] !== 1)
    .map((index) => ({
      key: `pulse${index}`,
      field: `data${6 + index}`,
      volumeField: `data${6 + index}m3`,
      name: data?.[`label_entree_imp${index}`]?.trim() || `Compteur ${index + 1}`,
    }));

  return {
    circuits,
    pulses,
    tariff: tariffFromOption(data?.option_tarifaire),
  };
}

// Codes `option_tarifaire` de l'écocompteur Legrand (mêmes valeurs que le champ
// téléinfo Linky du même nom) : 1 = Heures Creuses/Pleines, 4 = Tempo. Tout
// le reste (0 = Base, options non gérées ici) retombe sur un simple index Base.
function tariffFromOption(optionTarifaire) {
  const option = Number(optionTarifaire);
  if (option === 1) return 'hchp';
  if (option === 4) return 'tempo';
  return 'base';
}
