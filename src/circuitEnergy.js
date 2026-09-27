// -----------------------------------------------------------------------------
// Énergie cumulée par tore, reconstruite à partir de la puissance instantanée.
//
// L'écocompteur ne donne que des watts sur ses 5 tores (les CIR*_Nrj de
// inst.json restent à 0). On intègre donc la puissance dans le temps, par la
// méthode des trapèzes entre deux relevés, pour publier un vrai index en kWh :
// Gladys y accroche alors sa consommation et son coût 30 minutes, comme pour
// les index téléinfo.
//
// Le cumul est une valeur relative (0 à l'installation) : Gladys ne regarde
// que les différences. Il est persisté dans /data (le seul volume inscriptible
// du conteneur) pour survivre à un redémarrage.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'circuit-energy' });

const STATE_FILE = 'circuit-energy.json';
const STATE_VERSION = 1;

// Au-delà, le trou entre deux relevés n'est pas intégré (redémarrage,
// écocompteur injoignable) : on préfère sous-compter qu'inventer une énergie
// sur une période qu'on n'a pas observée.
const DEFAULT_MAX_GAP_MS = 5 * 60 * 1000;
// Écrire le fichier à chaque poll (jusqu'à 1 par seconde) userait le disque
// pour rien : au pire, un arrêt brutal perd la dernière minute.
const DEFAULT_PERSIST_INTERVAL_MS = 60 * 1000;

/**
 * @param {object} [options]
 * @param {string} [options.dataDir] dossier de persistance
 * @param {number} [options.maxGapMs]
 * @param {number} [options.persistIntervalMs]
 */
export function createCircuitEnergy({
  dataDir = process.env.DATA_DIR || '/data',
  maxGapMs = DEFAULT_MAX_GAP_MS,
  persistIntervalMs = DEFAULT_PERSIST_INTERVAL_MS,
} = {}) {
  // Wh cumulés, par external_id de feature (changer d'adresse d'écocompteur
  // crée un autre appareil, donc d'autres clés : pas de mélange).
  let totals = {};
  let lastSample = null;
  let lastPersistAt = 0;
  let dirty = false;
  const filePath = join(dataDir, STATE_FILE);

  async function load() {
    try {
      const state = JSON.parse(await readFile(filePath, 'utf8'));
      if (state?.version === STATE_VERSION && state.totals && typeof state.totals === 'object') {
        totals = Object.fromEntries(
          Object.entries(state.totals).filter(([, wh]) => Number.isFinite(wh) && wh >= 0),
        );
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cumul d'énergie illisible (${filePath}), repart de zéro : ${err.message}`);
      }
    }
  }

  /**
   * Ajoute un relevé de puissances et renvoie les cumuls en kWh.
   * @param {Record<string, number>} powers W par external_id de feature
   * @param {number} timestamp ms
   * @returns {Record<string, number>} kWh par external_id (3 décimales)
   */
  function addSample(powers, timestamp) {
    const current = Object.fromEntries(
      Object.entries(powers).map(([id, watts]) => [id, Math.max(0, Number(watts) || 0)]),
    );
    const elapsedMs = lastSample ? timestamp - lastSample.timestamp : 0;
    if (lastSample && elapsedMs > 0 && elapsedMs <= maxGapMs) {
      const hours = elapsedMs / 3_600_000;
      for (const [id, watts] of Object.entries(current)) {
        const previous = lastSample.powers[id] ?? watts;
        totals[id] = (totals[id] ?? 0) + ((previous + watts) / 2) * hours;
      }
      dirty = true;
    }
    lastSample = { timestamp, powers: current };
    return Object.fromEntries(
      Object.keys(current).map((id) => [id, Math.round(totals[id] ?? 0) / 1000]),
    );
  }

  async function persist({ force = false, now = Date.now() } = {}) {
    if (!dirty || (!force && now - lastPersistAt < persistIntervalMs)) return;
    try {
      await mkdir(dataDir, { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify({ version: STATE_VERSION, totals }));
      // Écriture atomique : un arrêt pendant l'écriture laisse l'ancien fichier intact.
      await rename(tmpPath, filePath);
      lastPersistAt = now;
      dirty = false;
    } catch (err) {
      logger.warn(`Sauvegarde du cumul d'énergie impossible (${filePath}) : ${err.message}`);
    }
  }

  return { load, addSample, persist };
}
