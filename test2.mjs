import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const paths = await page.locator('.leaflet-pane path').count();
  console.log('Polygon paths:', paths);

  const svgs = await page.locator('.leaflet-overlay-pane svg').count();
  console.log('Overlay SVGs:', svgs);

  await page.screenshot({ path: '/tmp/jinx-map-test.png', fullPage: true });
  console.log('Screenshot: /tmp/jinx-map-test.png');

  await browser.close();
}

test().catch(console.error);
