import { afterEach, expect, test, vi } from 'vitest'
import { loadPolygons } from './polygons'

const payload = {
  version: 1 as const,
  polygons: [
    {
      name: 'אזור בדיקה 1',
      rings: [[[32.07, 34.77]]],
      bounds: [32.07, 34.77, 32.07, 34.77] as [number, number, number, number],
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('loads /polygons.json when available', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url === '/polygons.json') {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }),
  )

  const result = await loadPolygons()
  expect(result.source).toBe('polygons.json')
  expect(result.payload.polygons).toHaveLength(1)
  expect(result.payload.polygons[0]?.name).toBe('אזור בדיקה 1')
})

test('falls back to fixtures when /polygons.json fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url === '/polygons.json') {
        return new Response('not found', { status: 404 })
      }
      if (url === '/fixtures/polygons.fixture.json') {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }),
  )

  const result = await loadPolygons()
  expect(result.source).toBe('fixtures')
  expect(result.payload.polygons[0]?.name).toBe('אזור בדיקה 1')
})

