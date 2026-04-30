import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(join(__dirname, '..', 'dts-visualizer.html')).href;
const FIXTURE = '/home/woodrow/work/github/linux/arch/riscv/boot/dts/sifive/fu740-c000.dtsi';
const DTS = readFileSync(FIXTURE, 'utf8');
const outDir = join(__dirname, '..', 'screenshots');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto(HTML_URL);
await page.fill('#dts-textarea', DTS);
await page.click('#btn-parse');
await page.waitForSelector('#tree-container:not(.hidden)');
await page.waitForFunction(() => document.querySelectorAll('.node').length > 0);

const views = [
  { view: 'cpu', name: '4-block-cpu.png' },
  { view: 'cache', name: '5-block-cache.png' },
  { view: 'interrupt', name: '6-block-interrupt.png' },
];

for (const v of views) {
  await page.selectOption('#view-select', v.view);
  await page.selectOption('#layout-select', 'block');
  await page.waitForFunction(() => document.querySelectorAll('.block').length > 0);
  await page.waitForTimeout(800); // let zoom-to-fit finish

  const blocks = await page.locator('.block').count();
  const containers = await page.locator('.block.container').count();
  const leaves = await page.locator('.block.leaf').count();
  await page.screenshot({ path: join(outDir, v.name), fullPage: false });
  console.log(`${v.name} — view=${v.view} blocks=${blocks} (containers=${containers}, leaves=${leaves})`);
}

await browser.close();
