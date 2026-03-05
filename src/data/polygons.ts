export type LatLng = [lat: number, lng: number]
export type Bounds = [minLat: number, minLng: number, maxLat: number, maxLng: number]

export type NormalizedPolygon = {
  name: string
  rings: LatLng[][]
  bounds: Bounds
}

export type PolygonsPayloadV1 = {
  version: 1
  polygons: NormalizedPolygon[]
  generatedAt?: string
  source?: string
}

export type PolygonsLoadSource = 'polygons.json' | 'fixtures'

export type LoadPolygonsResult = {
  source: PolygonsLoadSource
  payload: PolygonsPayloadV1
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`)
  }
  return response.json()
}

function isLatLngPair(value: unknown): value is LatLng {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  )
}

function isBounds(value: unknown): value is Bounds {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  )
}

function isPolygon(value: unknown): value is NormalizedPolygon {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<NormalizedPolygon>
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return false
  if (!Array.isArray(candidate.rings) || candidate.rings.length === 0) return false
  if (!candidate.rings.every((ring) => Array.isArray(ring) && ring.length > 0 && ring.every(isLatLngPair))) {
    return false
  }
  if (!isBounds(candidate.bounds)) return false
  return true
}

function coercePayload(value: unknown): PolygonsPayloadV1 {
  if (!value || typeof value !== 'object') {
    throw new Error('Unexpected polygons payload (not an object)')
  }

  const candidate = value as Partial<PolygonsPayloadV1>
  if (candidate.version !== 1 || !Array.isArray(candidate.polygons)) {
    throw new Error('Unexpected polygons payload shape')
  }

  const polygons = candidate.polygons.filter(isPolygon)
  if (polygons.length === 0) {
    throw new Error('Polygons payload did not contain any valid polygons')
  }

  return {
    version: 1,
    polygons,
    generatedAt: typeof candidate.generatedAt === 'string' ? candidate.generatedAt : undefined,
    source: typeof candidate.source === 'string' ? candidate.source : undefined,
  }
}

export async function loadPolygons(): Promise<LoadPolygonsResult> {
  try {
    const raw = await fetchJson('/polygons.json')
    return { source: 'polygons.json', payload: coercePayload(raw) }
  } catch {
    const raw = await fetchJson('/fixtures/polygons.fixture.json')
    return { source: 'fixtures', payload: coercePayload(raw) }
  }
}

