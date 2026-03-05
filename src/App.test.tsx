import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'

const polygonsPayload = {
  version: 1 as const,
  polygons: [
    {
      name: 'אזור בדיקה 1',
      rings: [
        [
          [32.07, 34.77],
          [32.07, 34.82],
          [32.1, 34.82],
          [32.1, 34.77],
          [32.07, 34.77],
        ],
      ],
      bounds: [32.07, 34.77, 32.1, 34.82] as [number, number, number, number],
    },
  ],
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.endsWith('/polygons.json') || url === '/polygons.json') {
        return new Response(JSON.stringify(polygonsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/fixtures/polygons.fixture.json') || url === '/fixtures/polygons.fixture.json') {
        return new Response(JSON.stringify(polygonsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('not found', { status: 404 })
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('renders Hebrew RTL shell controls', () => {
  render(<App />)
  expect(screen.getByLabelText('חיפוש אזור')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'רענון' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'הגדרות' })).toBeInTheDocument()
  const status = screen.getByLabelText('סטטוס')
  expect(status).toHaveTextContent('אב־טיפוס מקומי')
  expect(status).toHaveTextContent('ריענון כל 60 שנ׳')
})

test('persists fade duration minutes in localStorage', () => {
  localStorage.setItem('jinx.fadeMinutes', '45')
  render(<App />)

  fireEvent.click(screen.getByRole('button', { name: 'הגדרות' }))

  const minutesInput = screen.getByLabelText('משך דהייה עד שקיפות 0 (בדקות)') as HTMLInputElement
  expect(minutesInput.value).toBe('45')

  fireEvent.change(minutesInput, { target: { value: '30' } })
  expect(localStorage.getItem('jinx.fadeMinutes')).toBe('30')
})

test('updates last-updated indicator on refresh', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-05T12:34:00.000Z'))

  render(<App />)
  expect(screen.getByLabelText('סטטוס')).toHaveTextContent('עודכן לאחרונה: לא עודכן עדיין')

  fireEvent.click(screen.getByRole('button', { name: 'רענון' }))
  expect(screen.getByLabelText('סטטוס')).toHaveTextContent('עודכן לאחרונה: 12:34')
})
