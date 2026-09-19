#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Sonde de développement : interroge un vrai écocompteur et affiche EXACTEMENT
// ce que l'intégration publierait dans Gladys, sans instance Gladys ni conteneur.
//
//   ECO_HOST=192.168.1.140 npm run probe
//
// Utile pour valider le câblage des tores et les libellés avant d'installer
// l'intégration, et pour reproduire un bug sans toucher à la domotique.
// -----------------------------------------------------------------------------

import { fetchInstant, fetchData, fetchMetadata } from '../src/ecocompteur.js';
import { normalizeConfig } from '../src/config.js';
import { ecocompteur, setMetadata } from '../src/devices/ecocompteur.js';
import { buildDiscoveredDevices } from '../src/devices/index.js';

const host = process.env.ECO_HOST || process.argv[2];

if (!host) {
  console.error('Usage : ECO_HOST=192.168.1.140 npm run probe   (ou : node scripts/probe.js <ip>)');
  process.exit(1);
}

// Gladys simulé : on se contente de collecter ce qui serait publié.
function createProbeGladys() {
  const published = [];
  return {
    published,
    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },
    async publishStates(states) {
      published.push(...states);
    },
    async publishState(featureExternalId, state) {
      published.push({ device_feature_external_id: featureExternalId, state });
    },
  };
}

const config = normalizeConfig({ host });
const gladys = createProbeGladys();

console.log(`\n=== Écocompteur ${host} ===\n`);

const [inst, data] = await Promise.all([fetchInstant(host), fetchData(host)]);
console.log('inst.json  :', JSON.stringify(inst));
console.log('data.json  :', JSON.stringify(data));

const metadata = await fetchMetadata(host);
setMetadata(metadata);
console.log(`\nOption tarifaire détectée : ${metadata.tariff}`);
console.log(
  `Entrées à impulsions actives : ${metadata.pulses.map((p) => p.name).join(', ') || 'aucune'}`,
);

const [device] = buildDiscoveredDevices(gladys, config);
console.log(`\n--- Appareil déclaré : ${device.name} (${device.external_id}) ---`);
for (const feature of device.features) {
  console.log(`  ${feature.name.padEnd(24)} ${feature.category}/${feature.type} (${feature.unit})`);
}

await ecocompteur.onPoll(gladys, config);
console.log('\n--- Valeurs qui seraient publiées ---');
for (const state of gladys.published) {
  const name =
    device.features.find((f) => f.external_id === state.device_feature_external_id)?.name ??
    state.device_feature_external_id;
  console.log(`  ${name.padEnd(24)} ${state.text ?? state.state}`);
}
console.log('');
