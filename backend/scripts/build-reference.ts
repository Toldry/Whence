/**
 * Downloads Travelpayouts' reference files (about 10 MB) and writes a slim copy
 * to src/data/reference.json, which the server and the Worker bundle.
 * Run it now and then to pick up new airports: npm run build:reference
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimReference } from '../src/providers/reference-data.ts';
import type { RawReference } from '../src/providers/reference-data.ts';

const BASE_URL = 'https://api.travelpayouts.com/data/en';
const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/reference.json');

async function download(file: keyof RawReference): Promise<unknown[]> {
  const response = await fetch(`${BASE_URL}/${file}.json`);
  if (!response.ok) throw new Error(`${file}.json: HTTP ${response.status}`);
  return (await response.json()) as unknown[];
}

const [airports, cities, countries, airlines] = await Promise.all(
  (['airports', 'cities', 'countries', 'airlines'] as const).map(download));
const slim = slimReference({ airports, cities, countries, airlines } as RawReference);

const text = JSON.stringify(slim);
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, text + '\n');
console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}: ${slim.airports.length} airports, `
  + `${slim.cities.length} cities, ${(text.length / 1e6).toFixed(2)} MB`);
