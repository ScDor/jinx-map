import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('renders Hebrew app shell', () => {
  render(<App />)
  expect(screen.getByText('אב־טיפוס מקומי • ריענון כל 60 שנ׳')).toBeInTheDocument()
})
