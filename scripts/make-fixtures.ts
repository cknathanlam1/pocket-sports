// Writes the synthetic sensor recordings used by tests/swing.test.ts.
// Real recordings from the phone's dev recorder (/p/CODE?dev) go in the same folder with an
// `expected.peaks` array added by hand.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { standardSession } from '../tests/fixtures/synth.ts';

const dir = resolve(import.meta.dirname, '../tests/fixtures/recordings');
mkdirSync(dir, { recursive: true });
for (const [name, rec] of [
  ['iphone-synthetic.json', standardSession('iphone', 11)],
  ['android-synthetic.json', standardSession('android', 22)],
] as const) {
  writeFileSync(resolve(dir, name), JSON.stringify(rec));
  console.log(`wrote ${name}: ${rec.events.length} events, ${rec.expected?.peaks.length} swings`);
}
