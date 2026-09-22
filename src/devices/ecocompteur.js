// -----------------------------------------------------------------------------
// Type d'appareil : ÉCOCOMPTEUR LEGRAND
//
// Un seul appareil physique, avec :
//   - 5 features « puissance » (les 5 tores de mesure)
//   - les index téléinfo (HC/HP, ou Base selon l'option tarifaire)
//   - les entrées à impulsions activées (gaz, eau), en index et en volume
//
// Les libellés des features viennent de l'écocompteur lui-même : ce que
// l'utilisateur a nommé dans SON interface se retrouve tel quel dans Gladys.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { fetchInstant, fetchData } from '../ecocompteur.js';

const DEVICE_TYPE = 'ecocompteur';

const logger = createLogger({ name: DEVICE_TYPE });

// Table de correspondance des codes `option_tarifaire`. 1 (HC/HP) et 2
// (Tempo) confirmés par des retours utilisateurs réels sur de vrais appareils
// (voir CLAUDE.md) ; 0 (Base) déduit par élimination, jamais observé
// directement. Code inconnu -> valeur brute affichée telle quelle plutôt
// qu'une étiquette inventée.
const OPTION_TARIFAIRE_LABELS = {
  0: 'Base',
  1: 'HC/HP',
  2: 'Tempo',
};

// Table de correspondance des codes `tarif_courant` (période tarifaire en
// cours). 1, 2, 8 et 9 confirmés par observation réelle (heure + calendrier
// Tempo du jour cohérents) ; 0, 3-7 et 10 déduits par un motif logique (Base,
// EJP, puis Tempo HC et HP x3 couleurs) mais jamais observés sur un vrai
// appareil — à corriger si un retour utilisateur les contredit.
const TARIF_COURANT_LABELS = {
  0: 'Base',
  1: 'Heure Creuse',
  2: 'Heure Pleine',
  3: 'Heures Normales (EJP)',
  4: 'Heures de Pointe Mobile (EJP)',
  5: 'Heure Creuse Bleu',
  6: 'Heure Creuse Blanc',
  7: 'Heure Creuse Rouge',
  8: 'Heure Pleine Bleu',
  9: 'Heure Pleine Blanc',
  10: 'Heure Pleine Rouge',
};

/** Libellé lisible pour un code, ou le code brut si absent de la table. */
function readableLabel(table, rawValue) {
  const code = Number(rawValue);
  return table[code] ?? String(rawValue);
}

// Métadonnées de repli tant que l'écocompteur n'a pas été interrogé.
const FALLBACK_METADATA = {
  circuits: [1, 2, 3, 4, 5].map((i) => ({
    key: `circuit${i}`,
    field: `data${i}`,
    name: `Circuit ${i}`,
  })),
  pulses: [],
  tariff: 'hchp',
};

let metadata = FALLBACK_METADATA;

/** Injecte les métadonnées lues sur l'appareil (appelé avant la découverte). */
export function setMetadata(next) {
  metadata = next ?? FALLBACK_METADATA;
}

/** Métadonnées courantes (exposé pour les tests). */
export function getMetadata() {
  return metadata;
}

/**
 * L'écocompteur n'expose ni numéro de série ni adresse MAC sur son API : son
 * adresse est le seul identifiant stable dont on dispose. Elle sert donc de
 * `platformId`. Conséquence documentée : changer l'IP de l'appareil crée un
 * nouvel appareil dans Gladys — d'où le bail DHCP fixe recommandé.
 */
function platformId(config) {
  return config.host.replace(/^https?:\/\//i, '').replace(/[^\w.-]/g, '-') || 'unknown';
}

/** Feature « puissance » d'un tore. */
function powerFeature(ids, circuit) {
  return {
    name: circuit.name,
    external_id: ids.feature(circuit.key),
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
    unit: DEVICE_FEATURE_UNITS.WATT,
    min: 0,
    max: 30000,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/** Feature « index » (téléinfo ou compteur d'impulsions), en kWh. */
function indexFeature(ids, key, name) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.INDEX,
    unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000000,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/** Feature « volume » d'une entrée à impulsions (gaz, eau), en m³. */
function volumeFeature(ids, key, name) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.VOLUME_SENSOR,
    type: DEVICE_FEATURE_TYPES.VOLUME_SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CUBIC_METER,
    min: 0,
    max: 1000000,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/**
 * Feature « tarif en cours » (`tarif_courant`) : période tarifaire active
 * (Heure Creuse/Pleine, ou couleur Tempo). Publiée en texte lisible
 * (`readableLabel`, voir `TARIF_COURANT_LABELS`) plutôt qu'avec le type SDK
 * `teleinformation/ntarf` — ce dernier affiche un badge « NTARF » dans
 * Gladys, un sigle Enedis qui ne veut rien dire pour l'utilisateur final.
 */
function tariffPeriodFeature(ids) {
  return {
    name: 'Tarif en cours',
    external_id: ids.feature('tarif-courant'),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    // Voir commentaire de tariffOptionFeature : min/max NOT NULL en base
    // même pour une feature TEXT, sans effet fonctionnel ici.
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    // Contrairement à Option tarifaire (contrat, quasi constant), celle-ci
    // change plusieurs fois par jour (HC/HP, ou les 6 combinaisons Tempo) :
    // l'historique a un vrai intérêt ici.
    keep_history: true,
  };
}

/**
 * Feature « option tarifaire » (`option_tarifaire`, ex. 1 = HC/HP, 4 = Tempo).
 * Même traitement que l'abonnement : une valeur de contrat, quasi constante,
 * publiée en texte pour transparence plutôt que pour être suivie dans le temps.
 */
function tariffOptionFeature(ids) {
  return {
    name: 'Option tarifaire',
    external_id: ids.feature('option-tarifaire'),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    // `min`/`max` sont NOT NULL en base (colonne DOUBLE) pour toute
    // fonctionnalité, même texte, où ils n'ont aucun sens fonctionnel :
    // valeurs arbitraires, jamais utilisées pour une feature TEXT.
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false,
  };
}

/**
 * Feature « abonnement » (intensité souscrite, `isousc`). Aucune catégorie
 * dédiée à une intensité souscrite (valeur de contrat, pas une mesure) dans le
 * SDK : publiée en texte simple plutôt que détournée sous un capteur de courant.
 * Valeur quasi constante (change seulement si le contrat change) : pas d'intérêt
 * à conserver l'historique.
 */
function subscriptionFeature(ids) {
  return {
    name: 'Abonnement (A)',
    external_id: ids.feature('abonnement'),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    // Voir commentaire de tariffOptionFeature : min/max NOT NULL en base
    // même pour une feature TEXT, sans effet fonctionnel ici.
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false,
  };
}

// Index téléinfo des 3 couleurs Tempo. Toujours à zéro hors option tarifaire
// Tempo (`option_tarifaire = 4`) : `buildDevice`/`onPoll` ne les créent/publient
// que dans ce cas, comme pour HC/HP et Base.
const TEMPO_INDEXES = [
  { key: 'index-hc-bleu', field: 'conso_hc_b', name: 'Index Heures Creuses Bleu' },
  { key: 'index-hp-bleu', field: 'conso_hp_b', name: 'Index Heures Pleines Bleu' },
  { key: 'index-hc-blanc', field: 'conso_hc_w', name: 'Index Heures Creuses Blanc' },
  { key: 'index-hp-blanc', field: 'conso_hp_w', name: 'Index Heures Pleines Blanc' },
  { key: 'index-hc-rouge', field: 'conso_hc_r', name: 'Index Heures Creuses Rouge' },
  { key: 'index-hp-rouge', field: 'conso_hp_r', name: 'Index Heures Pleines Rouge' },
];

// Wh -> kWh, arrondi au millième (3 décimales). Les index bruts de
// l'écocompteur sont des Wh entiers exacts : diviser par 1000 est une
// conversion sans perte à cette précision, contrairement à l'ancien
// arrondi au dixième de kWh (résolution 100 Wh) qui écrasait inutilement
// la précision réelle disponible — et donc celle du calcul de consommation
// 30 min de Gladys, basé sur le delta entre deux relevés successifs.
function toKilowattHour(wattHours) {
  const value = Number(wattHours);
  return Number.isFinite(value) ? Math.round(value) / 1000 : null;
}

export const ecocompteur = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys, config) {
    return gladys.externalIds(DEVICE_TYPE, platformId(config)).device;
  },

  buildDevice(gladys, config) {
    const ids = gladys.externalIds(DEVICE_TYPE, platformId(config));
    const features = metadata.circuits.map((circuit) => powerFeature(ids, circuit));

    if (config.publish_indexes) {
      features.push(tariffPeriodFeature(ids));
      features.push(tariffOptionFeature(ids));
      features.push(subscriptionFeature(ids));
      if (metadata.tariff === 'hchp') {
        features.push(indexFeature(ids, 'index-hc', 'Index Heures Creuses'));
        features.push(indexFeature(ids, 'index-hp', 'Index Heures Pleines'));
      } else if (metadata.tariff === 'tempo') {
        for (const tempoIndex of TEMPO_INDEXES) {
          features.push(indexFeature(ids, tempoIndex.key, tempoIndex.name));
        }
      } else {
        features.push(indexFeature(ids, 'index-base', 'Index Base'));
      }
    }

    for (const pulse of metadata.pulses) {
      features.push(volumeFeature(ids, `${pulse.key}-volume`, `${pulse.name} (volume)`));
    }

    return {
      name: 'Écocompteur Legrand',
      external_id: ids.device,
      // Gladys n'accepte qu'un enum fermé en millisecondes côté cœur
      // (1/2/10/15/30/60 s, voir DEVICE_POLL_FREQUENCIES) : le config_schema
      // expose ces mêmes valeurs en secondes (plus lisible), converties ici.
      should_poll: true,
      poll_frequency: Number(config.poll_frequency || 60) * 1000,
      features,
    };
  },

  // Bouton « Tester la connexion » de l'écran de configuration.
  actions: {
    async test_connection(gladys, { config }) {
      logger.info(`Action test_connection -> ${config.host}`);
      const inst = await fetchInstant(config.host);
      const total = metadata.circuits.reduce((sum, c) => sum + Number(inst[c.field] || 0), 0);
      return {
        en: `Eco-meter reached: ${Math.round(total)} W measured across the ${metadata.circuits.length} channels.`,
        fr: `Écocompteur joignable : ${Math.round(total)} W mesurés sur les ${metadata.circuits.length} tores.`,
      };
    },
  },

  async onPoll(gladys, config) {
    const ids = gladys.externalIds(DEVICE_TYPE, platformId(config));
    const inst = await fetchInstant(config.host);

    const states = metadata.circuits.map((circuit) => ({
      device_feature_external_id: ids.feature(circuit.key),
      state: Math.round(Number(inst[circuit.field] || 0)),
    }));

    for (const pulse of metadata.pulses) {
      const volume = Number(inst[pulse.volumeField]);
      if (Number.isFinite(volume)) {
        states.push({
          device_feature_external_id: ids.feature(`${pulse.key}-volume`),
          state: Math.round(volume * 1000) / 1000,
        });
      }
    }

    if (config.publish_indexes) {
      const data = await fetchData(config.host);

      // Features TEXT : le serveur exige le champ `text` (chaîne), jamais
      // `state` — réservé aux valeurs numériques (voir saveStates.js côté
      // cœur Gladys, qui valide l'un ou l'autre mais pas une chaîne sous `state`).
      if (data.tarif_courant !== undefined) {
        states.push({
          device_feature_external_id: ids.feature('tarif-courant'),
          text: readableLabel(TARIF_COURANT_LABELS, data.tarif_courant),
        });
      }

      const isousc = Number(data.isousc);
      if (Number.isFinite(isousc)) {
        states.push({
          device_feature_external_id: ids.feature('abonnement'),
          text: String(isousc),
        });
      }

      if (data.option_tarifaire !== undefined) {
        states.push({
          device_feature_external_id: ids.feature('option-tarifaire'),
          text: readableLabel(OPTION_TARIFAIRE_LABELS, data.option_tarifaire),
        });
      }

      if (metadata.tariff === 'hchp') {
        const hc = toKilowattHour(data.conso_hc);
        const hp = toKilowattHour(data.conso_hp);
        if (hc !== null) {
          states.push({ device_feature_external_id: ids.feature('index-hc'), state: hc });
        }
        if (hp !== null) {
          states.push({ device_feature_external_id: ids.feature('index-hp'), state: hp });
        }
      } else if (metadata.tariff === 'tempo') {
        for (const tempoIndex of TEMPO_INDEXES) {
          const value = toKilowattHour(data[tempoIndex.field]);
          if (value !== null) {
            states.push({ device_feature_external_id: ids.feature(tempoIndex.key), state: value });
          }
        }
      } else {
        const base = toKilowattHour(data.conso_base);
        if (base !== null) {
          states.push({ device_feature_external_id: ids.feature('index-base'), state: base });
        }
      }
    }

    logger.debug(`Publication de ${states.length} états`);
    await gladys.publishStates(states);
  },
};

// Exporté pour les tests unitaires.
export const internals = {
  toKilowattHour,
  platformId,
  readableLabel,
  OPTION_TARIFAIRE_LABELS,
  TARIF_COURANT_LABELS,
};
