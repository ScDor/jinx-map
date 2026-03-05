import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

if (typeof window !== 'undefined') {
  const candidate = (window as unknown as { localStorage?: unknown }).localStorage as
    | { clear?: unknown }
    | undefined

  if (!candidate || typeof candidate.clear !== 'function') {
    const store = new Map<string, string>()
    const shim = {
      get length() {
        return store.size
      },
      clear() {
        store.clear()
      },
      getItem(key: string) {
        return store.has(key) ? store.get(key)! : null
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null
      },
      removeItem(key: string) {
        store.delete(key)
      },
      setItem(key: string, value: string) {
        store.set(key, String(value))
      },
    } satisfies Storage

    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true })
    Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true })
  }
}
