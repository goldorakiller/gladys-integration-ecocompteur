import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import {
  parseEcocompteurJson,
  baseUrl,
  internals as ecocompteurInternals,
} from '../src/ecocompteur.js';
import { ecocompteur, setMetadata, internals } from '../src/devices/ecocompteur.js';
import { buildDiscoveredDevices, findBlueprintByDevice } from '../src/devices/index.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

// Réponses réelles d'un écocompteur (capturées sur l'appareil).
const INST_JSON = `{
    "data1":470.000000,
    "data2":91.000000,
    "data3":0.000000,
    "data4":0.000000,
    "data5":0.000000,
    "data6":0.000000,
    "data6m3":0.000000,
    "data7":12.000000,
    "data7m3":3.456000,
    "heure":0,
    "minute":1,
    "Date_Time":1789516897
}`;

const DATA_JSON = `{
	"option_tarifaire" : 1,
	"tarif_courant" : 2,
	"isousc" : 45,
	"conso_base" : 0,
	"conso_hc"   : 012323332,
	"conso_hp"   : 011201263,
	"label_entree1" : "Chauffage",
	"label_entree2" : "Eau chaude",
	"label_entree3" : "Prises de Courant",
	"label_entree4" : "Prises de Courant",
	"label_entree5" : "Prises de Courant",
	"label_entree_imp0" : "Gaz",
	"label_entree_imp1" : "Eau",
	"entree_imp0_disabled" : 1,
	"entree_imp1_disabled" : 0
}`;

// Aucun écocompteur en option tarifaire Tempo sous la main pour capturer une
// vraie réponse : structure conforme à la doc, valeurs synthétiques (zéros en
// tête inclus, pour exercer le même correctif JSON que le fixture HC/HP).
const DATA_JSON_TEMPO = `{
	"option_tarifaire" : 4,
	"tarif_courant" : 11,
	"isousc" : 30,
	"conso_base" : 0,
	"conso_hc"   : 0,
	"conso_hp"   : 0,
	"conso_hc_b" : 05000000,
	"conso_hp_b" : 04000000,
	"conso_hc_w" : 02000000,
	"conso_hp_w" : 01500000,
	"conso_hc_r" : 00300000,
	"conso_hp_r" : 00200000,
	"label_entree1" : "Chauffage",
	"label_entree2" : "Eau chaude",
	"label_entree3" : "Prises de Courant",
	"label_entree4" : "Prises de Courant",
	"label_entree5" : "Prises de Courant"
}`;

const METADATA = {
  circuits: [
    { key: 'circuit1', field: 'data1', name: 'Chauffage' },
    { key: 'circuit2', field: 'data2', name: 'Eau chaude' },
    { key: 'circuit3', field: 'data3', name: 'Prises de Courant' },
    { key: 'circuit4', field: 'data4', name: 'Prises de Courant' },
    { key: 'circuit5', field: 'data5', name: 'Prises de Courant' },
  ],
  pulses: [{ key: 'pulse1', field: 'data7', volumeField: 'data7m3', name: 'Eau' }],
  tariff: 'hchp',
};

const METADATA_TEMPO = { ...METADATA, pulses: [], tariff: 'tempo' };

const config = normalizeConfig({ host: '192.168.1.140' });

test('tariffFromOption reconnaît HC/HP, Tempo et Base', () => {
  assert.equal(ecocompteurInternals.tariffFromOption(1), 'hchp');
  assert.equal(ecocompteurInternals.tariffFromOption(4), 'tempo');
  assert.equal(ecocompteurInternals.tariffFromOption(0), 'base');
  assert.equal(ecocompteurInternals.tariffFromOption(undefined), 'base');
});

test('les index à zéros en tête sont parsés sans planter', () => {
  const data = parseEcocompteurJson(DATA_JSON);
  assert.equal(data.conso_hc, 12323332);
  assert.equal(data.conso_hp, 11201263);
  assert.equal(data.conso_base, 0);
});

test('les décimales de inst.json restent intactes', () => {
  const inst = parseEcocompteurJson(INST_JSON);
  assert.equal(inst.data1, 470);
  assert.equal(inst.data7m3, 3.456);
  assert.equal(inst.heure, 0);
});

test('baseUrl accepte les formes usuelles et refuse le vide', () => {
  assert.equal(baseUrl('192.168.1.140'), 'http://192.168.1.140');
  assert.equal(baseUrl('http://192.168.1.140/'), 'http://192.168.1.140');
  assert.throws(() => baseUrl(''), /Aucune adresse/);
});

test('la découverte reprend les libellés de l’écocompteur', () => {
  setMetadata(METADATA);
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);

  assert.equal(device.name, 'Écocompteur Legrand');
  // Enum fermé côté Gladys (DEVICE_POLL_FREQUENCIES) : en millisecondes.
  assert.equal(device.poll_frequency, 60000);
  assert.equal(device.should_poll, true);

  const names = device.features.map((f) => f.name);
  assert.ok(names.includes('Chauffage'));
  assert.ok(names.includes('Eau chaude'));
  assert.ok(names.includes('Index Heures Creuses'));
  assert.ok(names.includes('Tarif en cours'));
  assert.ok(names.includes('Abonnement (A)'));
  assert.ok(names.includes('Eau (volume)'));
  // L'entrée gaz est désactivée sur l'appareil : pas de feature créée.
  assert.ok(!names.some((n) => n.startsWith('Gaz')));

  const power = device.features.find((f) => f.name === 'Chauffage');
  assert.equal(power.category, DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR);
  assert.equal(power.type, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER);
  assert.equal(power.read_only, true);
});

test('les external_id des features sont uniques', () => {
  setMetadata(METADATA);
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  const ids = device.features.map((f) => f.external_id);
  assert.equal(new Set(ids).size, ids.length);
});

test("le blueprint se retrouve depuis l'external_id de l'appareil", () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  assert.equal(findBlueprintByDevice(gladys, device, config), ecocompteur);
});

test('les Wh sont convertis en kWh au dixième', () => {
  assert.equal(internals.toKilowattHour(12323332), 12323.3);
  assert.equal(internals.toKilowattHour(0), 0);
  assert.equal(internals.toKilowattHour('abc'), null);
});

test('la fréquence de polling est ramenée à la valeur permise la plus proche', () => {
  // Enum fermé côté cœur Gladys : 1/2/10/15/30/60 s. Le config_schema du
  // manifeste n'expose que ces 6 choix (select), mais on reste défensif ici
  // (config d'un manifeste antérieur encore stockée, valeur malformée...).
  assert.equal(normalizeConfig({ poll_frequency: 1 }).poll_frequency, 1);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: '30' }).poll_frequency, 30);
  assert.equal(normalizeConfig({ poll_frequency: 20 }).poll_frequency, 15);
});

test('onPoll publie une valeur par tore, plus index et volume', async () => {
  setMetadata(METADATA);
  const gladys = createFakeGladys();

  // Sert les réponses réelles à la place du réseau.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => (String(url).endsWith('/inst.json') ? INST_JSON : DATA_JSON),
  });

  try {
    await ecocompteur.onPoll(gladys, config);
  } finally {
    globalThis.fetch = realFetch;
  }

  // Chaque état ne porte que "state" (numérique) OU "text" (chaîne), jamais
  // les deux : on lit celui qui est renseigné.
  const byId = Object.fromEntries(
    gladys.published.map((p) => [p.featureExternalId, p.state ?? p.text]),
  );
  const prefix = 'ecocompteur:192.168.1.140';
  assert.equal(byId[`${prefix}:circuit1`], 470);
  assert.equal(byId[`${prefix}:circuit2`], 91);
  assert.equal(byId[`${prefix}:pulse1-volume`], 3.456);
  assert.equal(byId[`${prefix}:index-hc`], 12323.3);
  assert.equal(byId[`${prefix}:index-hp`], 11201.3);
  assert.equal(byId[`${prefix}:tarif-courant`], 2);
  assert.equal(byId[`${prefix}:abonnement`], '45');
});

test('Tempo : découverte et publication des 6 index couleur', async () => {
  setMetadata(METADATA_TEMPO);
  const gladys = createFakeGladys();

  const [device] = buildDiscoveredDevices(gladys, config);
  const names = device.features.map((f) => f.name);
  assert.ok(names.includes('Index Heures Creuses Bleu'));
  assert.ok(names.includes('Index Heures Pleines Rouge'));
  // Pas de mélange avec les branches HC/HP simple ou Base.
  assert.ok(!names.includes('Index Heures Creuses'));
  assert.ok(!names.includes('Index Base'));

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => (String(url).endsWith('/inst.json') ? INST_JSON : DATA_JSON_TEMPO),
  });
  try {
    await ecocompteur.onPoll(gladys, config);
  } finally {
    globalThis.fetch = realFetch;
  }

  const byId = Object.fromEntries(
    gladys.published.map((p) => [p.featureExternalId, p.state ?? p.text]),
  );
  const prefix = 'ecocompteur:192.168.1.140';
  assert.equal(byId[`${prefix}:index-hc-bleu`], 5000);
  assert.equal(byId[`${prefix}:index-hp-bleu`], 4000);
  assert.equal(byId[`${prefix}:index-hc-blanc`], 2000);
  assert.equal(byId[`${prefix}:index-hp-blanc`], 1500);
  assert.equal(byId[`${prefix}:index-hc-rouge`], 300);
  assert.equal(byId[`${prefix}:index-hp-rouge`], 200);
  assert.equal(byId[`${prefix}:option-tarifaire`], '4');
  assert.equal(byId[`${prefix}:tarif-courant`], 11);
});
