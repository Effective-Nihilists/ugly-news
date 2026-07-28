import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

/**
 * Renders the popup and returns its text.
 *
 * The popup asks the worker for the ACTIVE tab's report. Opened as an ordinary
 * tab it would be the active tab itself, so we bring the page back to the front
 * and reload the popup — that reproduces the real thing, where a popup is not a
 * tab and the page underneath stays active.
 */
async function popupTextFor(file: string): Promise<string> {
  // Stub the claim call. Without it the request reaches real ugly.press with no
  // session, correctly resolves to 'signed-out', and the popup BLOCKS with a
  // sign-in screen instead of the ladder — a race this test used to win only
  // because the router's 400 was being mis-read as a generic failure.
  await context.route('https://ugly.press/api/factClaims', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: { claims: [], status: 'ok', error: null },
      }),
    });
  });
  const page = await context.newPage();
  await page.goto(`${origin}/${file}`);
  await page.waitForFunction(
    () => document.documentElement.dataset['uglyFact'] ?? null,
    undefined,
    { timeout: 15_000 },
  );

  const [worker] = context.serviceWorkers();
  if (worker === undefined) throw new Error('no extension service worker');
  const extensionId = new URL(worker.url()).host;

  const popup = await context.newPage();
  const errors: string[] = [];
  popup.on('pageerror', (e) => errors.push(String(e)));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await popup.waitForFunction(
    () => (document.getElementById('root')?.textContent ?? '') !== '',
    undefined,
    { timeout: 10_000 },
  );

  const text = (await popup.textContent('#root')) ?? '';
  await popup.close();
  await page.close();
  await context.unroute('https://ugly.press/api/factClaims');
  if (errors.length > 0) throw new Error(`popup errored: ${errors.join('; ')}`);
  return text.replace(/\s+/g, ' ');
}

test('popup renders the source card and gate ladder for an article', async () => {
  const text = await popupTextFor('article.html');
  expect(text).toContain('Unrated source');
  expect(text).toContain('Declared article type');
  expect(text).toContain('Tier 0 · page shape');
  expect(text).toContain('Tier 3 · claims');
});

test('popup explains itself on a dormant product page', async () => {
  const text = await popupTextFor('product.html');
  expect(text).toContain('Dormant');
  expect(text).toContain('product listing');
});

/**
 * The rated-publisher path. The registry is keyed by hostname, so this serves
 * the article fixture *as* a real rated domain by fulfilling the request
 * locally — location.hostname becomes bbc.com without touching the network.
 */
test('resolves a rated publisher from the bundled registry', async () => {
  const page = await context.newPage();
  await page.route('https://www.bbc.com/**', async (route) => {
    const body = await readFile(join(fixtures, 'article.html'), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  await page.goto('https://www.bbc.com/news/transit-bill');

  const handle = await page.waitForFunction(
    () => document.documentElement.dataset['uglyFact'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  const report = JSON.parse((await handle.jsonValue()) as string) as Report;
  await page.close();

  expect(report.host).toBe('www.bbc.com');
  expect(report.rating).not.toBeNull();
  expect(report.rating?.name).toBe('BBC News');
  expect(report.verdict.engage).toBe(true);
});

// ─── Phase A: claims ────────────────────────────────────────────────────────
//
// The API is stubbed at the CONTEXT level, not the page level: the fetch runs
// in the extension's service worker, which page.route() does not intercept.

async function stubClaims(body: unknown): Promise<void> {
  await context.route('https://ugly.press/api/factClaims', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: body }),
    });
  });
}

async function unstub(): Promise<void> {
  await context.unroute('https://ugly.press/api/factClaims');
}

test('paints anchored claims on an engaged article', async () => {
  await stubClaims({
    claims: [
      {
        text: 'the Senate passed the National Transit Renewal Act 51-49 late Thursday',
        class: 'attribution',
        checkable: true,
      },
    ],
    status: 'ok',
  });
  const page = await context.newPage();
  await page.goto(`${origin}/article.html`);
  const count = await page.waitForFunction(
    () => document.documentElement.dataset['uglyFactClaims'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  expect(await count.jsonValue()).toBe('1');
  expect(
    await page.evaluate(() => CSS.highlights.has('ugly-fact-pending')),
  ).toBe(true);
  await page.close();
  await unstub();
});

test('drops a claim whose text is not on the page rather than misplacing it', async () => {
  await stubClaims({
    claims: [
      {
        text: 'a sentence that is nowhere in this article',
        class: 'attribution',
        checkable: true,
      },
    ],
    status: 'ok',
  });
  const page = await context.newPage();
  await page.goto(`${origin}/article.html`);
  const count = await page.waitForFunction(
    () => document.documentElement.dataset['uglyFactClaims'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  // The run completes with ZERO painted claims — the hallucinated span is
  // dropped rather than anchored somewhere plausible-looking.
  expect(await count.jsonValue()).toBe('0');
  expect(
    await page.evaluate(() => CSS.highlights.has('ugly-fact-pending')),
  ).toBe(false);
  await page.close();
  await unstub();
});

test('does not paint a claim marked not checkable', async () => {
  await stubClaims({
    claims: [
      {
        text: 'the Senate passed the National Transit Renewal Act 51-49 late Thursday',
        class: 'predictive',
        checkable: false,
      },
    ],
    status: 'ok',
  });
  const page = await context.newPage();
  await page.goto(`${origin}/article.html`);
  const count = await page.waitForFunction(
    () => document.documentElement.dataset['uglyFactClaims'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  expect(await count.jsonValue()).toBe('0');
  await page.close();
  await unstub();
});

// ─── Blocking states ────────────────────────────────────────────────────────

async function popupForStatus(status: string): Promise<string> {
  await stubClaims({ claims: [], status });
  const page = await context.newPage();
  await page.goto(`${origin}/article.html`);
  await page.waitForFunction(
    () => document.documentElement.dataset['uglyFactStatus'] ?? null,
    undefined,
    { timeout: 15_000 },
  );

  const [worker] = context.serviceWorkers();
  if (worker === undefined) throw new Error('no extension service worker');
  const extensionId = new URL(worker.url()).host;

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await popup.waitForFunction(
    () => (document.getElementById('root')?.textContent ?? '') !== '',
    undefined,
    { timeout: 10_000 },
  );
  const html = (await popup.innerHTML('#root')) || '';
  await popup.close();
  await page.close();
  await unstub();
  return html;
}

test('signed-out BLOCKS the popup and offers login', async () => {
  const html = await popupForStatus('signed-out');
  expect(html).toContain('Sign in');
  expect(html).toContain('https://ugly.press/');
  // It must BLOCK, not append a warning to the normal view.
  expect(html).not.toContain('Tier 0 · page shape');
});

test('no-credit BLOCKS the popup and offers billing', async () => {
  const html = await popupForStatus('no-credit');
  expect(html).toContain('Out of credit');
  expect(html).toContain('https://ugly.bot/account/billing');
  expect(html).not.toContain('Tier 0 · page shape');
});

test('the two blocking states send the user to DIFFERENT places', async () => {
  const signedOut = await popupForStatus('signed-out');
  const noCredit = await popupForStatus('no-credit');
  expect(signedOut).toContain('ugly.press');
  expect(signedOut).not.toContain('account/billing');
  expect(noCredit).toContain('account/billing');
});

// ─── Phase B: verdict colouring and the in-page popover ─────────────────────

const CLAIM_TEXT =
  'the Senate passed the National Transit Renewal Act 51-49 late Thursday';

async function stubQuick(body: unknown): Promise<void> {
  await context.route('https://ugly.press/api/factQuick', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: body }),
    });
  });
}

async function unstubQuick(): Promise<void> {
  await context.unroute('https://ugly.press/api/factQuick');
}

/** Paint one claim and colour it with the given verdict. */
async function articleWithVerdict(verdict: Record<string, unknown>) {
  await stubClaims({
    claims: [{ text: CLAIM_TEXT, class: 'attribution', checkable: true }],
    status: 'ok',
    error: null,
  });
  await stubQuick({ verdicts: [verdict], status: 'ok', error: null });
  const page = await context.newPage();
  await page.goto(`${origin}/article.html`);
  await page.waitForFunction(
    () => document.documentElement.dataset['uglyFactVerdicts'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  return page;
}

const RED_VERDICT = {
  id: 'c0',
  score: -1,
  band: 'red',
  forcedYellowReason: null,
  counted: 2,
  sources: [
    {
      name: 'Variety',
      bias: 'center',
      factuality: 'high',
      stance: 'refutes',
      independence: 1,
    },
    {
      name: 'The Hill',
      bias: 'center',
      factuality: 'very-high',
      stance: 'refutes',
      independence: 0.5,
    },
  ],
};

test('resolves a pending tint to the verdict colour', async () => {
  const page = await articleWithVerdict(RED_VERDICT);
  const bands = await page.evaluate(() => ({
    red: CSS.highlights.has('ugly-fact-red'),
    pending: CSS.highlights.has('ugly-fact-pending'),
  }));
  // The pending registry must be EMPTIED, not merely joined — a claim left in
  // two bands would paint both tints over the same text.
  expect(bands.red).toBe(true);
  expect(bands.pending).toBe(false);
  await page.close();
  await unstub();
  await unstubQuick();
});

test('an unverified verdict greys out rather than colouring', async () => {
  // Nobody covered it. That is not a pass and not a fail.
  const page = await articleWithVerdict({
    ...RED_VERDICT,
    band: 'unverified',
    score: 0,
    counted: 0,
    sources: [],
  });
  expect(await page.evaluate(() => CSS.highlights.has('ugly-fact-grey'))).toBe(
    true,
  );
  expect(await page.evaluate(() => CSS.highlights.has('ugly-fact-red'))).toBe(
    false,
  );
  await page.close();
  await unstub();
  await unstubQuick();
});

test('clicking a highlight opens the popover with the tally', async () => {
  const page = await articleWithVerdict(RED_VERDICT);
  // Highlights are not hit-testable, so click the TEXT and let the caret path
  // resolve it — which is exactly what a reader does.
  const box = await claimPoint(page);
  expect(box).not.toBeNull();

  await page.mouse.click(box.x, box.y);
  const host = page.locator('#ugly-fact-popover-host');
  await expect(host).toHaveCount(1);

  // The shadow root is CLOSED, so the card is unreachable from page script —
  // that is the point. Assert the host exists and that the page cannot pierce.
  const pierced = await page.evaluate(
    () =>
      (document.getElementById('ugly-fact-popover-host') as HTMLElement | null)
        ?.shadowRoot,
  );
  expect(pierced).toBeNull();
  await page.close();
  await unstub();
  await unstubQuick();
});

/** Centre of a word INSIDE the claim — the caret must land within the range. */
async function claimPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.evaluate((word) => {
    // Aim INSIDE the claim, not at the start of the containing text node —
    // the caret must land within the stored range for claimAtPoint to match.
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
      const t = n.textContent ?? '';
      const i = t.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + word.length);
      const rect = r.getBoundingClientRect();
      if (rect.width === 0) continue;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  }, 'Renewal');
  if (box === null) throw new Error('claim text not found on the page');
  return box;
}

test('HOVERING a highlight opens the card', async () => {
  const page = await articleWithVerdict(RED_VERDICT);
  const box = await claimPoint(page);
  await page.mouse.move(box.x, box.y);
  await expect(page.locator('#ugly-fact-popover-host')).toHaveCount(1);
  await page.close();
  await unstub();
  await unstubQuick();
});

test('a claim with NO verdict still opens, rather than doing nothing', async () => {
  // The state a failed verdict call leaves behind. Silence here made a whole
  // page feel inert, which is the most confusing thing this feature can do.
  await stubClaims({
    claims: [{ text: CLAIM_TEXT, class: 'attribution', checkable: true }],
    status: 'ok',
    error: null,
  });
  await stubQuick({ verdicts: [], status: 'ok', error: 'boom' });
  const page = await context.newPage();
  await page.goto(`${origin}/article.html`);
  await page.waitForFunction(
    () => document.documentElement.dataset['uglyFactClaims'] ?? null,
    undefined,
    { timeout: 15_000 },
  );
  const box = await claimPoint(page);
  await page.mouse.click(box.x, box.y);
  await expect(page.locator('#ugly-fact-popover-host')).toHaveCount(1);
  await page.close();
  await unstub();
  await unstubQuick();
});
