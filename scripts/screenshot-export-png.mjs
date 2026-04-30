// Drives the in-browser "Download PNG" button and saves the result into screenshots/
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
await page.waitForFunction(() => document.querySelectorAll('.node').length > 0);

const exports = [
  { view: 'cpu',       layout: 'block', save: '7-export-cpu-block.png' },
  { view: 'cache',     layout: 'block', save: '8-export-cache-block.png' },
  { view: 'interrupt', layout: 'block', save: '9-export-interrupt-block.png' },
];

for (const e of exports) {
  await page.selectOption('#view-select', e.view);
  await page.selectOption('#layout-select', e.layout);
  await page.waitForFunction(() => document.querySelectorAll('.block').length > 0);
  await page.waitForTimeout(700);

  const downloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-png');
  const download = await downloadPromise;
  const savePath = join(outDir, e.save);
  await download.saveAs(savePath);
  console.log(`${e.save} <- ${download.suggestedFilename()}`);
}

await browser.close();
