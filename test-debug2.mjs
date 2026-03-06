import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // Wait for polygons to load
  await page.waitForFunction(
    () => {
      const status = document.querySelector('.status');
      return status && status.textContent && status.textContent.includes('פוליגונים:');
    },
    { timeout: 10000 },
  );

  await page.waitForTimeout(2000);

  const status = await page.$eval('.status', (el) => el.textContent);
  console.log('Status:', status);

  // Get all leaflet elements
  const leafletInfo = await page.evaluate(() => {
    const container = document.querySelector('.leaflet-container');
    if (!container) return { error: 'No container' };

    // @ts-ignore
    const map = container._leaflet_map || container._leaflet_id;
    if (!map) return { error: 'No map object' };

    const results = {
      hasMap: !!map,
      zoom: map.getZoom?.(),
      center: map.getCenter?.() ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null,
      bounds: map.getBounds
        ? {
            south: map.getBounds().getSouth(),
            north: map.getBounds().getNorth(),
            east: map.getBounds().getEast(),
            west: map.getBounds().getWest(),
          }
        : null,
    };

    // Check layers
    const layers = map._layers;
    results.layerCount = Object.keys(layers).length;
    results.layers = Object.keys(layers).slice(0, 10);

    return results;
  });

  console.log('Leaflet info:', JSON.stringify(leafletInfo, null, 2));

  // Check for any SVG elements in the DOM
  const svgCount = await page.evaluate(() => document.querySelectorAll('svg').length);
  console.log('Total SVG elements:', svgCount);

  // Check what's inside leaflet-panes
  const paneContent = await page.evaluate(() => {
    const panes = document.querySelectorAll('.leaflet-pane');
    return Array.from(panes).map((pane) => ({
      class: pane.className,
      children: pane.children.length,
      innerHTML: pane.innerHTML.substring(0, 200),
    }));
  });
  console.log('Pane content:', JSON.stringify(paneContent, null, 2));

  await page.screenshot({ path: '/tmp/jinx-map-debug.png', fullPage: true });
  console.log('Screenshot saved');

  if (errors.length > 0) {
    console.log('\nErrors:', errors.slice(0, 3));
  }

  await browser.close();
}

test().catch(console.error);
