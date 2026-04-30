import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(join(__dirname, '..', 'dts-visualizer.html')).href;

const LINUX_ROOT = process.env.LINUX_ROOT || '/home/woodrow/work/github/linux';
const FIXTURE = join(LINUX_ROOT, 'arch/riscv/boot/dts/sifive/fu740-c000.dtsi');

if (!existsSync(FIXTURE)) {
  throw new Error(`Linux DTS fixture not found at ${FIXTURE}. Set LINUX_ROOT env var.`);
}
const DTS_SOURCE = readFileSync(FIXTURE, 'utf8');

let browser;
let page;
let pageErrors;

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
});

beforeEach(async () => {
  pageErrors = [];
  if (page) await page.close();
  page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(e));
  await page.goto(HTML_URL);
  await page.fill('#dts-textarea', DTS_SOURCE);
  await page.click('#btn-parse');
  await page.waitForSelector('#tree-container:not(.hidden)');
  await page.waitForFunction(() => document.querySelectorAll('.node').length > 0);
});

test('parses real linux DTSI and reports node count without runtime errors', async () => {
  const stats = await page.locator('#stats').textContent();
  assert.match(stats, /(\d+) nodes total/);
  const total = parseInt(stats.match(/(\d+) nodes total/)[1], 10);
  assert.ok(total >= 20, `expected >= 20 parsed nodes, got ${total}`);
  assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.map(e => e.message).join('; ')}`);
});

test('classifies fu740 CPU nodes with cpu styling', async () => {
  // /cpus is at depth 1 — visible. Its 5 cpu@N children at depth 2 are visible.
  const cpuNodeCount = await page.locator('.node.color-cpu').count();
  assert.ok(cpuNodeCount >= 5, `expected at least 5 CPU-classified nodes, got ${cpuNodeCount}`);
});

test('clicking a node populates the properties panel with path and properties', async () => {
  // Click the /cpus node (or any visible labeled node)
  await page.locator('.node').nth(1).click();
  const title = await page.locator('#props-title').textContent();
  assert.notEqual(title.trim(), 'Select a node');

  const content = await page.locator('#props-content').textContent();
  assert.match(content, /path/);
  assert.match(content, /\//);
});

test('search filters nodes and updates stats with match count', async () => {
  await page.fill('#search-input', 'ccache');
  await page.waitForFunction(() =>
    /\d+ matches \/ \d+ nodes/.test(document.getElementById('stats').textContent)
  );
  const stats = await page.locator('#stats').textContent();
  const m = stats.match(/(\d+) matches \/ (\d+) nodes/);
  assert.ok(m, `stats did not match expected format: ${stats}`);
  assert.ok(parseInt(m[1], 10) >= 1, 'expected ccache to match at least 1 node');

  // Highlighted nodes appear in the tree
  const highlighted = await page.locator('.node.highlight').count();
  assert.ok(highlighted >= 1, `expected highlighted node, got ${highlighted}`);
});

test('expand-all and collapse buttons change the visible node count', async () => {
  const initial = await page.locator('.node').count();

  await page.click('#btn-expand-all');
  await page.waitForFunction((init) =>
    document.querySelectorAll('.node').length > init, initial);
  const expanded = await page.locator('.node').count();
  assert.ok(expanded > initial, `expand-all should increase visible (${initial} -> ${expanded})`);

  await page.click('#btn-collapse');
  await page.waitForFunction((exp) =>
    document.querySelectorAll('.node').length < exp, expanded);
  const collapsed = await page.locator('.node').count();
  assert.ok(collapsed < expanded, `collapse should decrease visible (${expanded} -> ${collapsed})`);
});

test('switching to CPU subsystem view renders the /cpus subtree', async () => {
  await page.selectOption('#view-select', 'cpu');
  // Wait for re-render: header text becomes "cpus" or layout changes
  await page.waitForFunction(() => {
    const nodes = document.querySelectorAll('.node text');
    return Array.from(nodes).some(t => /cpu@\d+/.test(t.textContent || ''));
  });
  const cpuLabels = await page.locator('.node text').evaluateAll(els =>
    els.map(e => e.textContent).filter(t => /cpu@\d+/.test(t || ''))
  );
  assert.ok(cpuLabels.length >= 5, `expected >=5 cpu@N labels in CPU view, got ${cpuLabels.length}`);
});

test('phandle toggle draws phandle-link arrows when targets are visible', async () => {
  // Expand all first so &ccache target is visible
  await page.click('#btn-expand-all');
  await page.waitForFunction(() => document.querySelectorAll('.node').length > 10);

  // Initially no phandle-links rendered
  assert.equal(await page.locator('.phandle-link').count(), 0);

  await page.click('#btn-phandles');
  await page.waitForFunction(() => document.querySelectorAll('.phandle-link').length > 0);
  const phandleLinks = await page.locator('.phandle-link').count();
  // 5 CPUs each have next-level-cache=<&ccache>
  assert.ok(phandleLinks >= 5, `expected >=5 phandle links, got ${phandleLinks}`);
});

test('block diagram layout renders nested SVG rects for the CPU subsystem', async () => {
  await page.selectOption('#view-select', 'cpu');
  // Layout selector should now be visible
  await page.waitForSelector('#layout-select:not([style*="display:none"])', { timeout: 2000 });

  await page.selectOption('#layout-select', 'block');

  // Wait for .block elements to appear and tree .node elements to be cleared
  await page.waitForFunction(() =>
    document.querySelectorAll('.block').length > 0 &&
    document.querySelectorAll('.node').length === 0
  );

  const blocks = await page.locator('.block').count();
  // /cpus + 5 cpus + 5 intcs + cpu-map + ... — at least one container plus leaves
  assert.ok(blocks >= 6, `expected at least 6 blocks, got ${blocks}`);

  // Each block must have a <rect> child
  const blocksWithRect = await page.locator('.block rect').count();
  assert.equal(blocksWithRect, blocks, 'every block should have a rect');

  // Every CPU should appear as a block, and 5 of them carry color-cpu
  const cpuBlocks = await page.locator('.block.color-cpu').count();
  assert.ok(cpuBlocks >= 5, `expected >=5 .color-cpu blocks, got ${cpuBlocks}`);

  // Containment: a child block's rect must be geometrically inside its parent's rect.
  // We verify this by ensuring at least one block has another block fully nested inside.
  const containment = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('.block rect'));
    const boxes = blocks.map(r => ({
      x: +r.getAttribute('x'),
      y: +r.getAttribute('y'),
      w: +r.getAttribute('width'),
      h: +r.getAttribute('height'),
    }));
    let nested = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        const a = boxes[i], b = boxes[j];
        if (b.x > a.x && b.y > a.y &&
            b.x + b.w < a.x + a.w &&
            b.y + b.h < a.y + a.h) { nested++; break; }
      }
    }
    return nested;
  });
  assert.ok(containment >= 5, `expected at least 5 nested blocks (CPUs inside /cpus), got ${containment}`);
});

test('clicking a block in block layout populates the properties panel', async () => {
  await page.selectOption('#view-select', 'cpu');
  await page.selectOption('#layout-select', 'block');
  await page.waitForFunction(() => document.querySelectorAll('.block').length > 0);

  // Click a leaf block. Containers are visually covered by their children, so
  // we target a known leaf — cpu1_intc is the per-core intc inside cpu@1, no children.
  const intcLeaf = page.locator('.block.leaf', { hasText: 'cpu1_intc' }).first();
  await intcLeaf.click();

  await page.waitForFunction(() => {
    const t = document.getElementById('props-title')?.textContent || '';
    return /cpu1_intc|interrupt-controller/.test(t);
  });
  const title = await page.locator('#props-title').textContent();
  assert.match(title, /cpu1_intc|interrupt-controller/);
  const selected = page.locator('.block.selected');
  assert.equal(await selected.count(), 1, 'exactly one block should be selected');
});

test('Download PNG button exports a valid PNG file with the expected name', async () => {
  await page.selectOption('#view-select', 'cpu');
  await page.selectOption('#layout-select', 'block');
  await page.waitForFunction(() => document.querySelectorAll('.block').length > 0);

  // Wait for any in-flight zoom transition to settle so getBBox is stable
  await page.waitForTimeout(700);

  const downloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-png');
  const download = await downloadPromise;

  assert.equal(download.suggestedFilename(), 'dts-cpu-block.png');

  const savePath = join(tmpdir(), `e2e-${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(savePath);

  const buf = readFileSync(savePath);
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x4E);
  assert.equal(buf[3], 0x47);
  assert.ok(statSync(savePath).size > 5000, 'exported PNG should be more than a few KB');
});

test('block layout is hidden in DTS view and restored when re-entering a component view', async () => {
  // Start in DTS view
  await page.selectOption('#view-select', 'dts');
  const layoutSel = page.locator('#layout-select');
  assert.equal(await layoutSel.evaluate(el => el.style.display), 'none');

  // Switch to component view
  await page.selectOption('#view-select', 'cache');
  assert.notEqual(await layoutSel.evaluate(el => el.style.display), 'none');
});

test('clicking a phandle ref in the props panel navigates to the target', async () => {
  await page.click('#btn-expand-all');
  await page.waitForFunction(() => document.querySelectorAll('.node').length > 10);

  // Find and click a CPU node to surface its &ccache phandle in the props panel
  const cpu0 = page.locator('.node').filter({ hasText: 'cpu@0' }).first();
  await cpu0.click();

  // Wait for the props panel to render with a phandle-ref to ccache
  const phandleRef = page.locator('#props-content .phandle-ref', { hasText: 'ccache' }).first();
  await phandleRef.waitFor();
  await phandleRef.click();

  // After navigation, the props title should reflect the ccache node
  await page.waitForFunction(() => {
    const t = document.getElementById('props-title')?.textContent || '';
    return t.includes('ccache');
  });
  const title = await page.locator('#props-title').textContent();
  assert.match(title, /ccache/);
});
