import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // Wait for app to render
  await page.waitForTimeout(3000);

  // Get page title
  const title = await page.title();
  console.log('Page title:', title);

  // Check for any console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('CONSOLE ERROR:', msg.text());
    }
  });

  // Check if main elements exist
  const app = await page.$('.app');
  console.log('App container found:', !!app);

  const topbar = await page.$('.topbar');
  console.log('Topbar found:', !!topbar);

  const mapContainer = await page.$('.mapContainer');
  console.log('Map container found:', !!mapContainer);

  // Check leaflet container
  const leafletContainer = await page.$('.leaflet-container');
  console.log('Leaflet container found:', !!leafletContainer);

  // Get status text
  const status = await page.$eval('.status', (el) => el.textContent).catch(() => 'NOT FOUND');
  console.log('Status text:', status);

  // Check for polygons
  const polygons = await page.$$('.leaflet-pane path');
  console.log('Number of polygon paths:', polygons.length);

  // Take screenshot for debugging
  await page.screenshot({ path: '/tmp/jinx-map-screenshot.png', fullPage: true });
  console.log('Screenshot saved to /tmp/jinx-map-screenshot.png');

  // Get HTML structure
  const bodyHtml = await page.evaluate(() => document.body.innerHTML.substring(0, 500));
  console.log('Body HTML preview:', bodyHtml);

  await browser.close();
  console.log('Test completed');
}

test().catch(console.error);
