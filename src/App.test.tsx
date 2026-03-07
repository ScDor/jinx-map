import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const leafletSpies = vi.hoisted(() => ({
  fitBoundsSpy: vi.fn(),
  openPopupSpy: vi.fn(),
}));

const fitBoundsSpy = leafletSpies.fitBoundsSpy;
const openPopupSpy = leafletSpies.openPopupSpy;

vi.mock('./data/alarms', () => ({
  fetchAndComputeAlarms: vi.fn(async () => ({
    version: 1,
    computedAt: new Date().toISOString(),
    source: 'remote-range',
    rowsParsed: 1,
    zoneLastAlarm: {},
  })),
  loadStoredAlarmsState: vi.fn(() => null),
}));

vi.mock('react-leaflet', async () => {
  const React = await import('react');
  const mapStub = {
    fitBounds: leafletSpies.fitBoundsSpy,
    getZoom: () => 8,
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
  };
  return {
    MapContainer: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="leaflet-map">{children}</div>
    ),
    TileLayer: () => null,
    Polygon: React.forwardRef(
      (
        {
          children,
          pathOptions,
        }: { children?: React.ReactNode; pathOptions?: Record<string, unknown> },
        ref,
      ) => {
        const fillOpacity = pathOptions?.fillOpacity;
        const fillOpacityLabel = typeof fillOpacity === 'number' ? String(fillOpacity) : '';
        React.useEffect(() => {
          if (typeof ref === 'function')
            ref({
              openPopup: leafletSpies.openPopupSpy,
              getBounds: () => ({ getCenter: () => [0, 0] }),
            });
          return () => {
            if (typeof ref === 'function') ref(null);
          };
        }, [ref]);
        return (
          <div data-testid="leaflet-polygon" data-fill-opacity={fillOpacityLabel}>
            {children}
          </div>
        );
      },
    ),
    Popup: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="leaflet-popup">{children}</div>
    ),
    Marker: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="leaflet-marker">{children}</div>
    ),
    Tooltip: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="leaflet-tooltip">{children}</div>
    ),
    useMapEvents: () => mapStub,
  };
});

import App from './App';
import { fetchAndComputeAlarms } from './data/alarms';

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
};

beforeEach(() => {
  localStorage.clear();
  fitBoundsSpy.mockClear();
  openPopupSpy.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/polygons.json') || url === '/polygons.json') {
        return new Response(JSON.stringify(polygonsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url.endsWith('/fixtures/polygons.fixture.json') ||
        url === '/fixtures/polygons.fixture.json'
      ) {
        return new Response(JSON.stringify(polygonsPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('renders Hebrew RTL shell controls', () => {
  render(<App />);
  expect(screen.getByLabelText('חיפוש אזור')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'רענון' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'הגדרות' })).toBeInTheDocument();
  const status = screen.getByLabelText('סטטוס');
  expect(status).toHaveTextContent('אב־טיפוס מקומי');
  expect(status).toHaveTextContent('ריענון כל 60 שנ׳');
});

test.skip('renders a map with polygons overlay', async () => {
  render(<App />);
  expect(await screen.findByTestId('leaflet-map')).toBeInTheDocument();
  expect(await screen.findAllByTestId('leaflet-polygon')).toHaveLength(1);
});

test('persists fade duration minutes in localStorage', () => {
  localStorage.setItem('jinx.fadeMinutes', '45');
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: 'הגדרות' }));

  const minutesInput = screen.getByLabelText('משך דהייה עד שקיפות 0') as HTMLInputElement;
  expect(minutesInput.value).toBe('45');

  fireEvent.change(minutesInput, { target: { value: '30' } });
  expect(localStorage.getItem('jinx.fadeMinutes')).toBe('30');
});

test('updates last-updated indicator on refresh', async () => {
  vi.useFakeTimers();
  const flush = async () => {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    });
  };

  vi.setSystemTime(new Date('2026-03-05T12:00:00.000Z'));
  render(<App />);

  vi.runOnlyPendingTimers();
  await flush();
  expect(screen.getByLabelText('סטטוס')).toHaveTextContent('עודכן לאחרונה: 12:00');

  vi.setSystemTime(new Date('2026-03-05T12:34:00.000Z'));
  fireEvent.click(screen.getByRole('button', { name: 'רענון' }));
  await flush();
  expect(screen.getByLabelText('סטטוס')).toHaveTextContent('עודכן לאחרונה: 12:34');
});

test.skip('search suggestions focus the map and open the zone popup', async () => {
  vi.useFakeTimers();
  render(<App />);
  expect(screen.getByTestId('leaflet-map')).toBeInTheDocument();
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });

  const searchInput = screen.getByLabelText('חיפוש אזור') as HTMLInputElement;
  fireEvent.focus(searchInput);
  fireEvent.change(searchInput, { target: { value: 'בדיקה' } });

  await act(async () => {
    vi.advanceTimersByTime(250);
  });

  const listbox = screen.getByRole('listbox', { name: 'תוצאות חיפוש' });
  const option = listbox.querySelector('button');
  expect(option).toHaveTextContent('אזור בדיקה 1');

  fireEvent.click(option as Element);

  expect(searchInput.value).toBe('אזור בדיקה 1');
  expect(fitBoundsSpy).toHaveBeenCalledTimes(1);

  vi.runOnlyPendingTimers();
  expect(openPopupSpy).toHaveBeenCalledTimes(1);
});

test('recent zones panel lists alarms and allows focusing', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-05T12:00:00.000Z'));
  const fetchMock = vi.mocked(fetchAndComputeAlarms);
  fetchMock.mockResolvedValueOnce({
    version: 1,
    computedAt: new Date('2026-03-05T12:00:00.000Z').toISOString(),
    source: 'remote-range',
    rowsParsed: 1,
    zoneLastAlarm: { 'אזור בדיקה 1': '2026-03-05T11:00:00.000Z' },
  });

  render(<App />);
  vi.runOnlyPendingTimers();
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });

  fireEvent.click(screen.getByRole('button', { name: 'אזורים' }));
  const zonesPanel = screen.getByRole('complementary', { name: 'רשימת אזורים' });
  expect(zonesPanel).toBeInTheDocument();
  expect(within(zonesPanel).getByText('אזור בדיקה 1')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /אזור בדיקה 1/ }));
  expect(fitBoundsSpy).toHaveBeenCalledTimes(1);
  vi.runOnlyPendingTimers();
  expect(openPopupSpy).toHaveBeenCalledTimes(1);
});
