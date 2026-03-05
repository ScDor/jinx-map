import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const DEFAULT_SOURCE_URL =
  'https://raw.githubusercontent.com/amitfin/oref_alert/main/custom_components/oref_alert/metadata/area_to_polygon.json.zip';

const DEFAULT_OUTPUT_PATH = fileURLToPath(new URL('../public/polygons.json', import.meta.url));

function roundCoord(value) {
  return Math.round(value * 1e6) / 1e6;
}

function toRings(rawValue) {
  if (!Array.isArray(rawValue)) {
    throw new Error('Unexpected polygon value (not an array)');
  }

  if (rawValue.length === 0) return [];

  const first = rawValue[0];
  if (Array.isArray(first) && first.length === 2 && first.every((v) => typeof v === 'number')) {
    return [
      rawValue
        .map((pair) => [roundCoord(pair[0]), roundCoord(pair[1])])
        .filter((pair) => pair.length === 2),
    ];
  }

  if (Array.isArray(first) && Array.isArray(first[0])) {
    return rawValue.map((ring) =>
      ring
        .map((pair) => [roundCoord(pair[0]), roundCoord(pair[1])])
        .filter((pair) => pair.length === 2),
    );
  }

  throw new Error('Unexpected polygon coordinate structure');
}

function computeBounds(rings) {
  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const ring of rings) {
    for (const [lat, lng] of ring) {
      if (lat < minLat) minLat = lat;
      if (lng < minLng) minLng = lng;
      if (lat > maxLat) maxLat = lat;
      if (lng > maxLng) maxLng = lng;
    }
  }

  if (!Number.isFinite(minLat)) return null;
  return [minLat, minLng, maxLat, maxLng];
}

function parseArgs(argv) {
  const parsed = {
    sourceUrl: DEFAULT_SOURCE_URL,
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--url') {
      parsed.sourceUrl = argv[index + 1] ?? parsed.sourceUrl;
      index += 1;
      continue;
    }
    if (token === '--out') {
      parsed.outputPath = argv[index + 1] ?? parsed.outputPath;
      index += 1;
      continue;
    }
  }

  return parsed;
}

async function downloadZip(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status} ${response.statusText})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function extractJsonFromZip(zipBytes) {
  const files = unzipSync(zipBytes);
  const candidate =
    files['area_to_polygon.json'] ??
    Object.entries(files).find(([name]) => name.toLowerCase().endsWith('.json'))?.[1];

  if (!candidate) {
    throw new Error('ZIP did not contain a JSON file');
  }

  return strFromU8(candidate);
}

async function main() {
  const { sourceUrl, outputPath } = parseArgs(process.argv.slice(2));
  const zipBytes = await downloadZip(sourceUrl);
  const jsonText = extractJsonFromZip(zipBytes);

  const raw = JSON.parse(jsonText);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Unexpected JSON root (expected object mapping name -> coordinates)');
  }

  const polygons = [];
  for (const [name, rawValue] of Object.entries(raw)) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const rings = toRings(rawValue);
    const bounds = computeBounds(rings);
    if (!bounds || rings.length === 0) continue;
    polygons.push({ name, rings, bounds });
  }

  polygons.sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourceUrl,
    polygons,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload), 'utf8');

  process.stdout.write(`Wrote ${polygons.length} polygons to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
