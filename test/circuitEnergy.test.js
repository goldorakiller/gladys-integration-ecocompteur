import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCircuitEnergy } from '../src/circuitEnergy.js';

const HOUR = 3_600_000;

const tempDir = () => mkdtemp(join(tmpdir(), 'circuit-energy-'));

test('le premier relevé sert de référence, sans énergie comptée', async () => {
  const energy = createCircuitEnergy({ dataDir: await tempDir() });
  assert.deepEqual(energy.addSample({ a: 1000 }, 0), { a: 0 });
});

test('intégration par trapèzes entre deux relevés', async () => {
  const energy = createCircuitEnergy({ dataDir: await tempDir(), maxGapMs: 2 * HOUR });
  energy.addSample({ a: 1000, b: 0 }, 0);
  // 1 h de rampe 1000 -> 3000 W : 2000 Wh ; b passe de 0 à 500 W : 250 Wh.
  assert.deepEqual(energy.addSample({ a: 3000, b: 500 }, HOUR), { a: 2, b: 0.25 });
  // Puis 30 min à 3000 W constants : +1500 Wh.
  assert.deepEqual(energy.addSample({ a: 3000, b: 500 }, 1.5 * HOUR), { a: 3.5, b: 0.5 });
});

test("un trou plus long que maxGapMs n'est pas intégré", async () => {
  const energy = createCircuitEnergy({ dataDir: await tempDir(), maxGapMs: 5 * 60_000 });
  energy.addSample({ a: 2000 }, 0);
  assert.deepEqual(energy.addSample({ a: 2000 }, HOUR), { a: 0 });
  // Le relevé d'après le trou redevient la référence.
  assert.deepEqual(energy.addSample({ a: 2000 }, HOUR + 3 * 60_000), { a: 0.1 });
});

test('une puissance négative ou invalide compte pour zéro', async () => {
  const energy = createCircuitEnergy({ dataDir: await tempDir(), maxGapMs: 2 * HOUR });
  energy.addSample({ a: -500, b: 'abc' }, 0);
  assert.deepEqual(energy.addSample({ a: -500, b: 'abc' }, HOUR), { a: 0, b: 0 });
});

test('le cumul survit à un redémarrage (persistance puis rechargement)', async () => {
  const dataDir = await tempDir();
  const first = createCircuitEnergy({ dataDir, maxGapMs: 2 * HOUR });
  first.addSample({ a: 1000 }, 0);
  first.addSample({ a: 1000 }, HOUR);
  await first.persist({ force: true });

  const second = createCircuitEnergy({ dataDir, maxGapMs: 2 * HOUR });
  await second.load();
  // Après redémarrage, le premier relevé ne fait que reprendre la référence.
  assert.deepEqual(second.addSample({ a: 1000 }, 10 * HOUR), { a: 1 });
  assert.deepEqual(second.addSample({ a: 1000 }, 11 * HOUR), { a: 2 });
});

test("la sauvegarde n'écrit pas plus d'une fois par intervalle", async () => {
  const dataDir = await tempDir();
  const energy = createCircuitEnergy({ dataDir, maxGapMs: 2 * HOUR, persistIntervalMs: 60_000 });
  energy.addSample({ a: 1000 }, 0);
  energy.addSample({ a: 1000 }, HOUR);
  await energy.persist({ now: 100_000 });
  energy.addSample({ a: 1000 }, 2 * HOUR);
  await energy.persist({ now: 110_000 }); // trop tôt : ignorée
  const saved = JSON.parse(await readFile(join(dataDir, 'circuit-energy.json'), 'utf8'));
  assert.equal(saved.totals.a, 1000);
});

test('un fichier corrompu fait repartir de zéro sans planter', async () => {
  const dataDir = await tempDir();
  await writeFile(join(dataDir, 'circuit-energy.json'), '{pas du json');
  const energy = createCircuitEnergy({ dataDir });
  await energy.load();
  assert.deepEqual(energy.addSample({ a: 1000 }, 0), { a: 0 });
});
