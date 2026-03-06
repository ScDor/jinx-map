import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
      console.log('CONSOLE ERROR:', msg.text());
    }
  });

  page.on('pageerror', (error) => {
    console.log('PAGE ERROR:', error.message);
    errors.push(error.message);
  });

  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  await page.waitForTimeout(3000);

  const title = await page.title();
  console.log('Page title:', title);

  const app = await page.$('.app');
  console.log('App container found:', !!app);

  const topbar = await page.$('.topbar');
  console.log('Topbar found:', !!topbar);

  const mapContainer = await page.$('.mapContainer');
  console.log('Map container found:', !!mapContainer);

  const leafletContainer = await page.$('.leaflet-container');
  console.log('Leaflet container found:', !!leafletContainer);

  const status = await page.$eval('.status', (el) => el.textContent).catch(() => 'NOT FOUND');
  console.log('Status text:', status);

  // Check leaflet panes
  const leafletPanes = await page.$$('.leaflet-pane');
  console.log('Leaflet panes:', leafletPanes.length);

  // Check all paths in leaflet
  const allPaths = await page.$$('.leaflet-pane path');
  console.log('Number of polygon paths:', allPaths.length);

  // Check SVG elements
  const svgs = await page.$$('.leaflet-overlay-pane svg');
  console.log('Number of SVGs in overlay pane:', svgs.length);

  // Check tile layers
  const tiles = await page.$$('.leaflet-tile');
  console.log('Number of tile elements:', tiles.length);

  // Check map size
  const mapSize = await page.evaluate(() => {
    const container = document.querySelector('.leaflet-container');
    if (!container) return null;
    return {
      width: container.clientWidth,
      height: container.clientHeight,
    };
  });
  console.log('Map container size:', mapSize);

  // Check if any polygons have paths
  const polygonPaths = await page.evaluate(() => {
    const paths = document.querySelectorAll('.leaflet-pane path');
    return Array.from(paths).map((p) => ({
      d: p.getAttribute('d'),
      fill: p.getAttribute('fill'),
      opacity: p.getAttribute('opacity'),
    }));
  });
  console.log('Polygon path details:', polygonPaths.slice(0, 3));

  // Get bounding box
  const leafletMap = await page.evaluate(() => {
    const mapEl = document.querySelector('.leaflet-container');
    if (!mapEl) return null;
    // @ts-ignore
    return mapEl._leaflet_id;
  });
  console.log('Leaflet map ID:', leafletMap);

  await page.screenshot({ path: '/tmp/jinx-map-screenshot.png', fullPage: true });
  console.log('Screenshot saved to /tmp/jinx-map-screenshot.png');

  console.log('\n=== ERRORS ===');
  if (errors.length === 0) {
    console.log('No errors found');
  }

  await browser.close();
  console.log('Test completed');
}

test().catch(console.error);
