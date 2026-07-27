import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { createReadStream } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = join(here, '..', '..', 'extension', 'dist');
const fixtures = join(here, 'fixtures');

let context: BrowserContext;
let server: Server;
let origin: string;

// The manifest matches http/https only, so fixtures MUST be served over HTTP —
// a file:// URL never triggers the content script.
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const name = (req.url ?? '/').replace(/^\//, '').split('?')[0] ?? '';
    if (!/^[a-z0-9-]+\.html$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(join(fixtures, name)).pipe(res);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('server did not bind a port');
  }
  origin = `http://127.0.0.1:${String(addr.port)}`;

  context = await chromium.launchPersistentContext('', {
    // channel is required — see playwright.extension.config.ts for why.
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
    ],
  });
});

test.afterAll(async () => {
  await context.close();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

interface Report {
  verdict: { engage: boolean; stop: string | null; reason: string };
  rating: { name: string } | null;
  host: string;
}

async function reportFor(file: string): Promise<Report> {
  const page = await context.newPage();
  await page.goto(`${origin}/${file}`);
  const handle = await page.waitForFunction(
    () => document.documentElement.dataset['uglyFact'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  const json = (await handle.jsonValue()) as string;
  await page.close();
  return JSON.parse(json) as Report;
}

test('engages on an article fixture', async () => {
  const report = await reportFor('article.html');
  expect(report.verdict.engage).toBe(true);
  expect(report.verdict.stop).toBeNull();
});

test('stays dormant on a product page that also claims to be an article', async () => {
  const report = await reportFor('product.html');
  expect(report.verdict.engage).toBe(false);
  expect(report.verdict.stop).toBe('commerce');
  expect(report.verdict.reason.length).toBeGreaterThan(0);
});

test('reports an unrated host as null rather than guessing', async () => {
  const report = await reportFor('article.html');
  expect(report.host).toBe('127.0.0.1');
  expect(report.rating).toBeNull();
});

/**
 * Reads the action title back out of the service worker, which is the only
 * place chrome.action state is observable — it proves the content script
 * actually reached the background and that the badge was set for that tab.
 */
async function actionTitleFor(file: string): Promise<string> {
  const page = await context.newPage();
  await page.goto(`${origin}/${file}`);
  await page.waitForFunction(
    () => document.documentElement.dataset['uglyFact'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  const [worker] = context.serviceWorkers();
  if (worker === undefined) throw new Error('no extension service worker');
  const title = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) return '';
    return chrome.action.getTitle({ tabId: tab.id });
  });
  await page.close();
  return title;
}

test('sets the action title to the gate reason when dormant', async () => {
  const title = await actionTitleFor('product.html');
  expect(title).toContain('Dormant');
  expect(title).toContain('product listing');
});

test('sets the action title to the publisher when engaged but unrated', async () => {
  const title = await actionTitleFor('article.html');
  expect(title).toContain('Unrated publisher');
});
