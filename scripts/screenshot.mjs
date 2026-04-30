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

// Stage 1: paste DTS into the textarea — capture before clicking Parse
await page.fill('#dts-textarea', DTS);
await page.screenshot({ path: join(outDir, '1-dts-pasted.png'), fullPage: false });
console.log('1-dts-pasted.png — textarea filled with', DTS.length, 'chars from', FIXTURE);

// Stage 2: click Parse, wait for tree, capture full app
await page.click('#btn-parse');
await page.waitForSelector('#tree-container:not(.hidden)');
await page.waitForFunction(() => document.querySelectorAll('.node').length > 0);
await page.waitForTimeout(700); // let zoom-to-fit transition settle
await page.screenshot({ path: join(outDir, '2-tree-rendered.png'), fullPage: false });

const stats = await page.locator('#stats').textContent();
const cpuCount = await page.locator('.node.color-cpu').count();
console.log('2-tree-rendered.png —', stats, '| color-cpu nodes:', cpuCount);

// Stage 3: click a CPU node to populate the properties panel (proves parse + classification + click handlers)
const cpu0 = page.locator('.node').filter({ hasText: 'cpu@0' }).first();
await cpu0.click();
await page.waitForFunction(() => {
  const t = document.getElementById('props-title')?.textContent || '';
  return t.includes('cpu@0');
});
await page.screenshot({ path: join(outDir, '3-cpu0-selected.png'), fullPage: false });
console.log('3-cpu0-selected.png — properties panel populated for cpu0');

await browser.close();
