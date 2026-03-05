import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

test('renders Hebrew RTL shell controls', () => {
  render(<App />)
  expect(screen.getByLabelText('חיפוש אזור')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'רענון' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'הגדרות' })).toBeInTheDocument()
  expect(screen.getByLabelText('סטטוס')).toHaveTextContent('אב־טיפוס מקומי • ריענון כל 60 שנ׳')
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
