# Fact Checker Extension — Step 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the fact checker's gate and source card as a loadable MV3 extension — it decides whether a page is news, and if the publisher is rated it shows bias and factuality. No AI, no network, no endpoints.

**Architecture:** Pure decision logic lives in `shared/news/` (unit-tested under the repo's existing 90% coverage gate, the way `cluster-logic.ts` is). The extension in `extension/` is a thin shell: a DOM probe that produces plain data, a content script that calls the pure logic, a background worker that sets the toolbar badge, and a popup that renders the result. esbuild bundles three entry points into `extension/dist/`, which Chrome loads unpacked.

**Tech Stack:** TypeScript, esbuild, vitest, Playwright (Chromium with `--load-extension`), MV3.

## Global Constraints

- **Package manager is pnpm.** `preinstall` runs `only-allow pnpm`. Never `npm install`.
- **TypeScript strictness is on:** `strict`, `noUncheckedIndexedAccess` (indexed reads are `T | undefined`), `exactOptionalPropertyTypes` (never assign `undefined` to an optional prop — prefer `T | null` fields).
- **Coverage gate:** `vitest run --coverage` enforces 90% lines/functions/branches/statements over `shared/**` and `server/**`. New `shared/news/fact-*.ts` files are inside that gate and must be thoroughly tested.
- **eslint uses `parserOptions.project: true`** over `**/*.{ts,tsx}`. Any new `.ts` file must be inside `tsconfig.json`'s `include` or lint fails with "file not included in project". `tests/**` and `scripts/**` are eslint-ignored.
- **No `any` types** — `noExplicitAny` is enforced by `ugly-app/eslint`.
- **Content scripts cannot be ES modules.** Bundle the content entry as `iife`. The background service worker is `esm` with `"type": "module"` in the manifest.
- **This step makes zero network calls and zero AI calls.** If a task introduces `fetch`, it is out of scope.
- **Enum values are fixed by `shared/news/schemas.ts`** — `Bias` is exactly
  `far-left | left | lean-left | center | lean-right | right | far-right`, and
  `Factuality` is exactly `very-low | low | mixed | high | very-high`. There is
  no `left-center` or `right-center`. Any test fixture or colour map must use
  these spellings.
- Registry data in this step is **only** `shared/news/sourceBias.ts` (68 curated sources, committed). The ~3,875-row `domainBias` table is **not committed to git** and is out of scope here.

---

### Task 1: Extension scaffold and build pipeline

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/src/content/index.ts`
- Create: `extension/src/background/index.ts`
- Create: `extension/src/popup/popup.html`
- Create: `extension/src/popup/index.ts`
- Create: `scripts/build-extension.mjs`
- Modify: `tsconfig.json` (add `"extension"` to `include`)
- Modify: `package.json` (add `build:extension` script, add devDependencies)

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm run build:extension` → `extension/dist/{manifest.json,content.js,background.js,popup.js,popup.html}`, loadable via `chrome://extensions` → "Load unpacked".

- [ ] **Step 1: Add the dependencies**

```bash
cd /Users/admin/Documents/GitHub/ugly-news
pnpm add -D esbuild @types/chrome
```

`esbuild` currently resolves only transitively through vite; depend on it explicitly so a lockfile change cannot remove it. `@types/chrome` provides the `chrome.*` typings.

- [ ] **Step 2: Add `extension` to the TypeScript project**

In `tsconfig.json`, change the `include` array:

```json
  "include": ["src", "shared", "server", "client", "extension"],
```

Without this, `eslint` (which uses `parserOptions.project: true`) errors on every file under `extension/`.

- [ ] **Step 3: Write the manifest**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Ugly Fact Checker",
  "version": "0.1.0",
  "description": "Shows who published a page and how reliable they are.",
  "permissions": ["storage"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "Ugly Fact Checker"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

No `default_icon` — Chrome falls back to a generic action icon, and badge text still works. Icons are deliberately deferred so this task ships no binary assets.

- [ ] **Step 4: Write placeholder entry points**

Create `extension/src/content/index.ts`:

```ts
// Content script entry. Replaced with real behaviour in Task 5.
console.log('[ugly-fact] content script loaded');
```

Create `extension/src/background/index.ts`:

```ts
// Background service worker entry. Replaced with real behaviour in Task 6.
console.log('[ugly-fact] background loaded');
```

Create `extension/src/popup/popup.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Ugly Fact Checker</title>
  </head>
  <body>
    <div id="root">Loading…</div>
    <script src="popup.js"></script>
  </body>
</html>
```

Create `extension/src/popup/index.ts`:

```ts
// Popup entry. Replaced with real behaviour in Task 7.
const root = document.getElementById('root');
if (root) root.textContent = 'Ugly Fact Checker';
```

- [ ] **Step 5: Write the build script**

Create `scripts/build-extension.mjs`:

```js
// Bundles the MV3 extension into extension/dist/.
// Content scripts CANNOT be ES modules, so that entry is iife. The background
// service worker is declared "type": "module" in the manifest, so it is esm.
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'extension', 'src');
const out = join(root, 'extension', 'dist');
const dev = process.argv.includes('--dev');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  target: 'chrome110',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [join(src, 'content', 'index.ts')],
  outfile: join(out, 'content.js'),
  format: 'iife',
});

await build({
  ...common,
  entryPoints: [join(src, 'background', 'index.ts')],
  outfile: join(out, 'background.js'),
  format: 'esm',
});

await build({
  ...common,
  entryPoints: [join(src, 'popup', 'index.ts')],
  outfile: join(out, 'popup.js'),
  format: 'iife',
});

await copyFile(join(root, 'extension', 'manifest.json'), join(out, 'manifest.json'));
await copyFile(join(src, 'popup', 'popup.html'), join(out, 'popup.html'));

console.log('extension built →', out);
```

- [ ] **Step 6: Add the build script to package.json**

In `package.json` `scripts`, add:

```json
    "build:extension": "node scripts/build-extension.mjs",
    "build:extension:dev": "node scripts/build-extension.mjs --dev",
```

- [ ] **Step 7: Ignore build output**

Append to `.gitignore`:

```
extension/dist/
```

- [ ] **Step 8: Run the build and verify output**

Run: `pnpm run build:extension`
Expected: exits 0, prints `extension built → …/extension/dist`.

Run: `ls extension/dist`
Expected: `background.js  content.js  manifest.json  popup.html  popup.js`

- [ ] **Step 9: Verify it loads in Chrome**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Then manually: open `chrome://extensions`, enable Developer mode, "Load unpacked" → select `extension/dist`. Expected: the extension appears with no errors, and visiting any http(s) page logs `[ugly-fact] content script loaded` in the page console.

- [ ] **Step 10: Commit**

```bash
git add extension/manifest.json extension/src scripts/build-extension.mjs \
        tsconfig.json package.json pnpm-lock.yaml .gitignore
git commit -m "feat(extension): MV3 scaffold and esbuild build pipeline"
```

---

### Task 2: Pure page-gate logic

**Files:**
- Create: `shared/news/fact-gate.ts`
- Test: `tests/unit/news/fact-gate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PageSignals { ogType: string | null; schemaTypes: string[]; hasByline: boolean; publishedTime: string | null; wordCount: number }`
  - `type GateStop = 'commerce' | 'not-article' | 'too-short'`
  - `interface GateVerdict { engage: boolean; stop: GateStop | null; reason: string }`
  - `const MIN_ARTICLE_WORDS = 150`
  - `function classifyPage(signals: PageSignals): GateVerdict`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/news/fact-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  classifyPage,
  MIN_ARTICLE_WORDS,
  type PageSignals,
} from '../../../shared/news/fact-gate';

const base: PageSignals = {
  ogType: null,
  schemaTypes: [],
  hasByline: false,
  publishedTime: null,
  wordCount: 0,
};

describe('classifyPage', () => {
  it('engages on an og:type=article page with enough words', () => {
    const v = classifyPage({ ...base, ogType: 'article', wordCount: 600 });
    expect(v.engage).toBe(true);
    expect(v.stop).toBeNull();
  });

  it('engages on schema.org NewsArticle', () => {
    const v = classifyPage({ ...base, schemaTypes: ['NewsArticle'], wordCount: 600 });
    expect(v.engage).toBe(true);
  });

  it('engages on schema.org Article and BlogPosting', () => {
    for (const t of ['Article', 'BlogPosting', 'ReportageNewsArticle']) {
      expect(classifyPage({ ...base, schemaTypes: [t], wordCount: 600 }).engage).toBe(true);
    }
  });

  it('stops on commerce even when the page also claims to be an article', () => {
    const v = classifyPage({
      ...base,
      ogType: 'article',
      schemaTypes: ['Product', 'Offer'],
      wordCount: 600,
    });
    expect(v.engage).toBe(false);
    expect(v.stop).toBe('commerce');
  });

  it('stops on commerce for Offer, AggregateOffer and SoftwareApplication', () => {
    for (const t of ['Offer', 'AggregateOffer', 'SoftwareApplication']) {
      const v = classifyPage({ ...base, schemaTypes: [t], wordCount: 600 });
      expect(v.stop).toBe('commerce');
    }
  });

  it('stops on commerce from og:type=product', () => {
    expect(classifyPage({ ...base, ogType: 'product', wordCount: 600 }).stop).toBe('commerce');
  });

  it('engages on the byline+date heuristic when no schema is present', () => {
    const v = classifyPage({
      ...base,
      hasByline: true,
      publishedTime: '2026-07-27T10:00:00Z',
      wordCount: 600,
    });
    expect(v.engage).toBe(true);
  });

  it('does not engage on a byline alone without a date', () => {
    const v = classifyPage({ ...base, hasByline: true, wordCount: 600 });
    expect(v.engage).toBe(false);
    expect(v.stop).toBe('not-article');
  });

  it('stops as not-article on a bare page', () => {
    const v = classifyPage({ ...base, wordCount: 600 });
    expect(v.stop).toBe('not-article');
  });

  it('stops as too-short when article-shaped but under the word floor', () => {
    const v = classifyPage({
      ...base,
      ogType: 'article',
      wordCount: MIN_ARTICLE_WORDS - 1,
    });
    expect(v.engage).toBe(false);
    expect(v.stop).toBe('too-short');
  });

  it('engages exactly at the word floor', () => {
    const v = classifyPage({ ...base, ogType: 'article', wordCount: MIN_ARTICLE_WORDS });
    expect(v.engage).toBe(true);
  });

  it('is case-insensitive about type names', () => {
    expect(classifyPage({ ...base, schemaTypes: ['newsarticle'], wordCount: 600 }).engage).toBe(true);
    expect(classifyPage({ ...base, schemaTypes: ['PRODUCT'], wordCount: 600 }).stop).toBe('commerce');
  });

  it('always explains itself', () => {
    for (const s of [
      { ...base, wordCount: 600 },
      { ...base, ogType: 'product', wordCount: 600 },
      { ...base, ogType: 'article', wordCount: 10 },
      { ...base, ogType: 'article', wordCount: 600 },
    ]) {
      expect(classifyPage(s).reason.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/news/fact-gate.test.ts`
Expected: FAIL — cannot resolve `../../../shared/news/fact-gate`.

- [ ] **Step 3: Write the implementation**

Create `shared/news/fact-gate.ts`:

```ts
// Tier 0 of the gate: decide from page shape alone whether this page is worth
// looking at. Pure — the DOM reading that produces PageSignals lives in the
// extension's probe, so this stays unit-testable in a node environment.
//
// A *positive* non-news signal stops the ladder. Absence of a signal is not a
// negative signal: an unrated domain publishing genuine reporting still gets
// through, it just resolves against weaker evidence later.

/** Everything tier 0 needs, already extracted from the document. */
export interface PageSignals {
  /** `<meta property="og:type">`, lowercased by the probe, or null. */
  ogType: string | null;
  /** Every `@type` seen in JSON-LD blocks. May contain duplicates. */
  schemaTypes: string[];
  /** A byline was found (rel=author, .byline, schema author). */
  hasByline: boolean;
  /** `article:published_time` or schema datePublished, or null. */
  publishedTime: string | null;
  /** Visible words in the main text. */
  wordCount: number;
}

export type GateStop = 'commerce' | 'not-article' | 'too-short';

export interface GateVerdict {
  engage: boolean;
  /** null when engaging. */
  stop: GateStop | null;
  /** Always populated — dormant must be explainable, never silent. */
  reason: string;
}

/** Below this, an "article" is a stub, a nav page, or a paywall teaser. */
export const MIN_ARTICLE_WORDS = 150;

const COMMERCE_TYPES = new Set([
  'product',
  'productgroup',
  'offer',
  'aggregateoffer',
  'softwareapplication',
  'mobileapplication',
]);

const ARTICLE_TYPES = new Set([
  'article',
  'newsarticle',
  'reportagenewsarticle',
  'blogposting',
  'opinionnewsarticle',
  'analysisnewsarticle',
  'backgroundnewsarticle',
  'liveblogposting',
]);

export function classifyPage(signals: PageSignals): GateVerdict {
  const types = signals.schemaTypes.map((t) => t.toLowerCase());
  const ogType = signals.ogType === null ? null : signals.ogType.toLowerCase();

  // Commerce wins over everything: plenty of product pages also declare
  // og:type=article. We have no source base for marketing copy, so a positive
  // commerce signal ends it here.
  const commerce =
    (ogType !== null && COMMERCE_TYPES.has(ogType)) ||
    types.some((t) => COMMERCE_TYPES.has(t));
  if (commerce) {
    return {
      engage: false,
      stop: 'commerce',
      reason:
        'This is a product listing. The checker reads public-interest reporting and has no evidence base for marketing copy.',
    };
  }

  const declaredArticle =
    ogType === 'article' || types.some((t) => ARTICLE_TYPES.has(t));
  // Fallback for sites that publish no structured data at all: a byline AND a
  // publication date together are a reasonable article signature. Either alone
  // is not — plenty of product and profile pages carry one.
  const looksLikeArticle =
    signals.hasByline && signals.publishedTime !== null;

  if (!declaredArticle && !looksLikeArticle) {
    return {
      engage: false,
      stop: 'not-article',
      reason:
        'No article structure found — no article type, and no byline with a publication date.',
    };
  }

  if (signals.wordCount < MIN_ARTICLE_WORDS) {
    return {
      engage: false,
      stop: 'too-short',
      reason: `Only ${String(signals.wordCount)} words of body text — below the ${String(MIN_ARTICLE_WORDS)}-word floor for a checkable article.`,
    };
  }

  return {
    engage: true,
    stop: null,
    reason: declaredArticle
      ? 'Declared article type with enough body text.'
      : 'Byline and publication date with enough body text.',
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/news/fact-gate.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/news/fact-gate.ts tests/unit/news/fact-gate.test.ts
git commit -m "feat(fact): pure tier-0 page gate"
```

---

### Task 3: Pure source-registry lookup

**Files:**
- Create: `shared/news/fact-registry.ts`
- Test: `tests/unit/news/fact-registry.test.ts`

**Interfaces:**
- Consumes: `NewsSourceSeed` from `shared/news/sourceBias.ts`, `Bias`/`Factuality` from `shared/news/schemas.ts`.
- Produces:
  - `interface SourceRating { id: string; name: string; bias: Bias; biasScore: number; factuality: Factuality; owner: string | null; country: string | null }`
  - `type RegistryIndex = Record<string, SourceRating>`
  - `function buildRegistryIndex(seeds: readonly NewsSourceSeed[]): RegistryIndex`
  - `function normalizeHost(host: string): string`
  - `function lookupRating(host: string, index: RegistryIndex): SourceRating | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/news/fact-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildRegistryIndex,
  lookupRating,
  normalizeHost,
  type RegistryIndex,
} from '../../../shared/news/fact-registry';
import { newsSourceSeeds } from '../../../shared/news/sourceBias';

const index: RegistryIndex = buildRegistryIndex([
  {
    id: 'bbc',
    name: 'BBC News',
    homepage: 'https://www.bbc.com/news',
    domains: ['bbc.com', 'bbc.co.uk'],
    feedIds: ['bbc_world'],
    bias: 'center',
    biasScore: -0.5,
    factuality: 'high',
    owner: 'BBC (UK public)',
    country: 'UK',
  },
  {
    id: 'cnn',
    name: 'CNN',
    homepage: 'https://cnn.com',
    domains: ['cnn.com'],
    feedIds: ['cnn'],
    bias: 'lean-left',
    biasScore: -2,
    factuality: 'mixed',
    owner: 'Warner Bros. Discovery',
    country: 'US',
  },
]);

describe('normalizeHost', () => {
  it('lowercases and strips www', () => {
    expect(normalizeHost('WWW.BBC.CO.UK')).toBe('bbc.co.uk');
  });
  it('strips a trailing dot and port', () => {
    expect(normalizeHost('cnn.com.:8080')).toBe('cnn.com');
  });
  it('leaves a bare host alone', () => {
    expect(normalizeHost('cnn.com')).toBe('cnn.com');
  });
});

describe('lookupRating', () => {
  it('finds an exact domain', () => {
    expect(lookupRating('cnn.com', index)?.name).toBe('CNN');
  });

  it('finds via www', () => {
    expect(lookupRating('www.cnn.com', index)?.name).toBe('CNN');
  });

  it('falls back from a subdomain to the registered domain', () => {
    expect(lookupRating('edition.cnn.com', index)?.name).toBe('CNN');
  });

  it('handles a multi-label public suffix without a PSL', () => {
    // Walking suffixes longest-first finds bbc.co.uk before reaching co.uk,
    // and co.uk is never in the index, so no PSL is needed.
    expect(lookupRating('news.bbc.co.uk', index)?.name).toBe('BBC News');
  });

  it('returns null for an unknown host', () => {
    expect(lookupRating('example.com', index)).toBeNull();
  });

  it('does not match a domain that merely ends with a known one', () => {
    expect(lookupRating('notcnn.com', index)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(lookupRating('', index)).toBeNull();
  });

  it('carries bias, factuality, owner and country through', () => {
    const r = lookupRating('bbc.com', index);
    expect(r).not.toBeNull();
    expect(r?.bias).toBe('center');
    expect(r?.biasScore).toBe(-0.5);
    expect(r?.factuality).toBe('high');
    expect(r?.owner).toBe('BBC (UK public)');
    expect(r?.country).toBe('UK');
  });
});

describe('buildRegistryIndex over the real seeds', () => {
  it('indexes every domain of every seed', () => {
    const real = buildRegistryIndex(newsSourceSeeds);
    for (const seed of newsSourceSeeds) {
      for (const d of seed.domains) {
        expect(real[d]?.id).toBe(seed.id);
      }
    }
  });

  it('produces a non-trivial index', () => {
    expect(Object.keys(buildRegistryIndex(newsSourceSeeds)).length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/news/fact-registry.test.ts`
Expected: FAIL — cannot resolve `../../../shared/news/fact-registry`.

- [ ] **Step 3: Write the implementation**

Create `shared/news/fact-registry.ts`:

```ts
// Domain → publisher rating, for the registry bundled into the extension.
// Pure and dependency-free so the same code runs in a content script, in the
// Workers server, and under vitest.

import type { Bias, Factuality } from './schemas';
import type { NewsSourceSeed } from './sourceBias';

export interface SourceRating {
  id: string;
  name: string;
  bias: Bias;
  biasScore: number;
  factuality: Factuality;
  owner: string | null;
  country: string | null;
}

/** Flat domain → rating map. Every domain of every seed gets its own key. */
export type RegistryIndex = Record<string, SourceRating>;

export function buildRegistryIndex(
  seeds: readonly NewsSourceSeed[],
): RegistryIndex {
  const index: RegistryIndex = {};
  for (const seed of seeds) {
    const rating: SourceRating = {
      id: seed.id,
      name: seed.name,
      bias: seed.bias,
      biasScore: seed.biasScore,
      factuality: seed.factuality,
      owner: seed.owner,
      country: seed.country,
    };
    for (const domain of seed.domains) {
      index[normalizeHost(domain)] = rating;
    }
  }
  return index;
}

/** Lowercase, drop a port, drop a trailing dot, drop a leading `www.`. */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  const colon = h.indexOf(':');
  if (colon !== -1) h = h.slice(0, colon);
  while (h.endsWith('.')) h = h.slice(0, -1);
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

/**
 * Exact match, then progressively shorter suffixes.
 *
 * Walking suffixes longest-first means no Public Suffix List is needed: the
 * index only ever contains real registered domains, so `news.bbc.co.uk` finds
 * `bbc.co.uk` before it would ever reach `co.uk`, and `co.uk` is not a key.
 * Splitting on labels (rather than substring matching) is what stops
 * `notcnn.com` matching `cnn.com`.
 */
export function lookupRating(
  host: string,
  index: RegistryIndex,
): SourceRating | null {
  const normalized = normalizeHost(host);
  if (normalized === '') return null;

  const labels = normalized.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const hit = index[candidate];
    if (hit !== undefined) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/news/fact-registry.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Check the coverage gate still holds**

Run: `pnpm exec vitest run --coverage`
Expected: PASS, and `shared/news/fact-gate.ts` + `shared/news/fact-registry.ts` both at or above 90% on all four metrics. If either is below, add the missing cases to its test file rather than lowering the threshold.

- [ ] **Step 6: Commit**

```bash
git add shared/news/fact-registry.ts tests/unit/news/fact-registry.test.ts
git commit -m "feat(fact): pure domain→publisher registry lookup"
```

---

### Task 4: Generate the bundled registry

**Files:**
- Create: `scripts/gen-extension-registry.mjs`
- Create: `extension/src/generated/registry.ts` (generated, but committed)
- Modify: `package.json` (add `gen:extension-registry`, chain it into `build:extension`)

**Interfaces:**
- Consumes: `newsSourceSeeds` from `shared/news/sourceBias.ts`; `buildRegistryIndex` from `shared/news/fact-registry.ts`.
- Produces: `extension/src/generated/registry.ts` exporting `const BUNDLED_REGISTRY: RegistryIndex`.

- [ ] **Step 1: Write the generator**

Create `scripts/gen-extension-registry.mjs`:

```js
// Emits the registry the extension bundles, from the committed source seeds.
// Generated output IS committed so the extension builds without a DB, and so
// registry changes show up in review as a readable diff.
//
// The ~3,875-row domainBias table is deliberately NOT included here: it is not
// committed to this repo. Adding it later means extending this generator.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

register('tsx/esm', pathToFileURL('./'));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { newsSourceSeeds } = await import(
  pathToFileURL(join(root, 'shared', 'news', 'sourceBias.ts')).href
);
const { buildRegistryIndex } = await import(
  pathToFileURL(join(root, 'shared', 'news', 'fact-registry.ts')).href
);

const index = buildRegistryIndex(newsSourceSeeds);
const sorted = Object.fromEntries(
  Object.entries(index).sort(([a], [b]) => a.localeCompare(b)),
);

const out = join(root, 'extension', 'src', 'generated', 'registry.ts');
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  `// GENERATED by scripts/gen-extension-registry.mjs — do not edit by hand.\n` +
    `// Regenerate: pnpm run gen:extension-registry\n` +
    `import type { RegistryIndex } from '../../../shared/news/fact-registry';\n\n` +
    `export const BUNDLED_REGISTRY: RegistryIndex = ${JSON.stringify(sorted, null, 2)};\n`,
  'utf8',
);

console.log(
  `registry → ${out} (${String(Object.keys(sorted).length)} domains, ${String(newsSourceSeeds.length)} sources)`,
);
```

- [ ] **Step 2: Add the scripts**

In `package.json` `scripts`, add `gen:extension-registry` and make the build depend on it:

```json
    "gen:extension-registry": "node scripts/gen-extension-registry.mjs",
    "build:extension": "pnpm run gen:extension-registry && node scripts/build-extension.mjs",
    "build:extension:dev": "pnpm run gen:extension-registry && node scripts/build-extension.mjs --dev",
```

- [ ] **Step 3: Generate and inspect**

Run: `pnpm run gen:extension-registry`
Expected: prints `registry → …/extension/src/generated/registry.ts (N domains, 68 sources)` with N > 50.

Run: `head -20 extension/src/generated/registry.ts`
Expected: the generated header comment, the import, and the start of a sorted object literal.

- [ ] **Step 4: Verify it typechecks and builds**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm run build:extension`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-extension-registry.mjs extension/src/generated/registry.ts package.json
git commit -m "feat(extension): generate the bundled publisher registry from sourceBias"
```

---

### Task 5: DOM probe and content script

**Files:**
- Create: `extension/src/content/probe.ts`
- Modify: `extension/src/content/index.ts`
- Create: `extension/src/shared/messages.ts`
- Test: `tests/e2e/extension-gate.spec.ts`
- Test fixtures: `tests/e2e/fixtures/article.html`, `tests/e2e/fixtures/product.html`
- Create: `playwright.extension.config.ts`
- Modify: `playwright.config.ts` (ignore extension specs)
- Modify: `package.json` (add `test:extension`)

**Interfaces:**
- Consumes: `classifyPage`, `PageSignals`, `GateVerdict` from `shared/news/fact-gate`; `lookupRating`, `SourceRating` from `shared/news/fact-registry`; `BUNDLED_REGISTRY` from `extension/src/generated/registry`.
- Produces:
  - `function readPageSignals(doc: Document): PageSignals`
  - `interface PageReport { verdict: GateVerdict; rating: SourceRating | null; host: string }`
  - message `{ type: 'ugly-fact:page-report'; report: PageReport }` sent to the background worker.

- [ ] **Step 1: Define the message contract**

Create `extension/src/shared/messages.ts`:

```ts
import type { GateVerdict } from '../../../shared/news/fact-gate';
import type { SourceRating } from '../../../shared/news/fact-registry';

export interface PageReport {
  verdict: GateVerdict;
  rating: SourceRating | null;
  host: string;
}

export const PAGE_REPORT = 'ugly-fact:page-report' as const;

export interface PageReportMessage {
  type: typeof PAGE_REPORT;
  report: PageReport;
}
```

- [ ] **Step 2: Write the probe**

Create `extension/src/content/probe.ts`:

```ts
import type { PageSignals } from '../../../shared/news/fact-gate';

function metaContent(doc: Document, selector: string): string | null {
  const el = doc.querySelector(selector);
  if (el === null) return null;
  const v = el.getAttribute('content');
  return v === null || v.trim() === '' ? null : v.trim();
}

/** Every `@type` in every JSON-LD block, flattened. Malformed blocks are skipped. */
function schemaTypes(doc: Document): string[] {
  const out: string[] = [];
  const blocks = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const block of Array.from(blocks)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.textContent ?? '');
    } catch {
      continue; // a broken block must not take the whole probe down
    }
    collectTypes(parsed, out);
  }
  return out;
}

function collectTypes(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectTypes(child, out);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const rec = node as Record<string, unknown>;
  const t = rec['@type'];
  if (typeof t === 'string') out.push(t);
  else if (Array.isArray(t)) {
    for (const item of t) if (typeof item === 'string') out.push(item);
  }
  // @graph and nested objects both carry types worth seeing.
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
    if (key in rec) collectTypes(rec[key], out);
  }
}

function hasByline(doc: Document): boolean {
  if (doc.querySelector('[rel="author"], [itemprop="author"], .byline, .author') !== null) {
    return true;
  }
  return metaContent(doc, 'meta[name="author"]') !== null;
}

function publishedTime(doc: Document): string | null {
  return (
    metaContent(doc, 'meta[property="article:published_time"]') ??
    metaContent(doc, 'meta[itemprop="datePublished"]') ??
    metaContent(doc, 'meta[name="date"]') ??
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ??
    null
  );
}

/** Words in the body, minus chrome we know is not prose. */
function wordCount(doc: Document): number {
  const root = doc.querySelector('article') ?? doc.body;
  if (root === null) return 0;
  const clone = root.cloneNode(true) as HTMLElement;
  for (const el of Array.from(
    clone.querySelectorAll('script, style, nav, header, footer, aside, noscript'),
  )) {
    el.remove();
  }
  const text = clone.textContent ?? '';
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

export function readPageSignals(doc: Document): PageSignals {
  return {
    ogType: metaContent(doc, 'meta[property="og:type"]'),
    schemaTypes: schemaTypes(doc),
    hasByline: hasByline(doc),
    publishedTime: publishedTime(doc),
    wordCount: wordCount(doc),
  };
}
```

- [ ] **Step 3: Wire the content script**

Replace `extension/src/content/index.ts`:

```ts
import { classifyPage } from '../../../shared/news/fact-gate';
import { lookupRating } from '../../../shared/news/fact-registry';
import { BUNDLED_REGISTRY } from '../generated/registry';
import { PAGE_REPORT, type PageReportMessage } from '../shared/messages';
import { readPageSignals } from './probe';

// Tier 0 + tier 1 only: read the DOM we already have, and one map lookup.
// No network, no model call. Runs on idle so it never competes with the
// site's own scripts during load.
function run(): void {
  const host = location.hostname;
  const report = {
    verdict: classifyPage(readPageSignals(document)),
    rating: lookupRating(host, BUNDLED_REGISTRY),
    host,
  };
  const message: PageReportMessage = { type: PAGE_REPORT, report };
  // The worker may be asleep; a failed send is not worth surfacing.
  void chrome.runtime.sendMessage(message).catch(() => undefined);
  // Exposed for the E2E test to read without needing the extension's world.
  document.documentElement.dataset['uglyFact'] = JSON.stringify(report);
}

if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => {
    run();
  });
} else {
  setTimeout(run, 0);
}
```

- [ ] **Step 4: Write the E2E fixtures**

Create `tests/e2e/fixtures/article.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Senate clears transit bill</title>
    <meta property="og:type" content="article" />
    <meta property="article:published_time" content="2026-07-27T04:00:00Z" />
    <script type="application/ld+json">
      { "@context": "https://schema.org", "@type": "NewsArticle", "headline": "Senate clears transit bill" }
    </script>
  </head>
  <body>
    <article>
      <h1>Senate clears transit bill</h1>
      <p class="byline">By A. Reporter</p>
      <p>
        Washington — after a debate that ran past midnight, the Senate passed the National
        Transit Renewal Act 51-49 late Thursday, sending the measure to the House. Supporters
        called the package the largest federal transit investment in decades, and the bill's
        lead sponsor said the programme would begin cutting household commuting costs within
        two years of the first disbursement. Opponents said the price tag would add
        substantially to the deficit over the decade, a figure disputed by the bill's authors,
        who put the net cost at less than half that. The bill's backers point to long-running
        structural problems in regional transit systems. Ridership on regional rail has fallen
        in recent years, a decline that accelerated during the pandemic and has not fully
        reversed. Analysts expect construction on the first tranche of projects to begin next
        spring, though the House timetable remains unsettled. The measure now moves to the
        House, where leadership has not yet scheduled a vote, and where several members have
        already signalled they will seek amendments to the financing provisions before any
        floor consideration can begin in earnest this autumn.
      </p>
    </article>
  </body>
</html>
```

Create `tests/e2e/fixtures/product.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Meridian Trail GTX</title>
    <meta property="og:type" content="article" />
    <script type="application/ld+json">
      { "@context": "https://schema.org", "@type": "Product", "name": "Meridian Trail GTX",
        "offers": { "@type": "Offer", "price": "184.00", "priceCurrency": "USD" } }
    </script>
  </head>
  <body>
    <h1>Meridian Trail GTX</h1>
    <p>The only trail shoe certified waterproof to IPX7. Cuts impact force by up to 40 percent
      versus standard foam. Hand-finished in Italy. Rated best trail shoe of the year by three
      magazines. Free returns within thirty days on all full-price orders placed through the
      online store, with express delivery available in most metropolitan areas at checkout.</p>
  </body>
</html>
```

Note the product fixture *also* declares `og:type=article` — that is the case that proves commerce wins.

- [ ] **Step 5a: Give the extension its own Playwright config**

The repo's `playwright.config.ts` declares a `webServer` that runs `npm run dev`
(the full ugly-news stack, Docker and Postgres included) and three browser
projects. An extension test needs none of that: it loads `file://` fixtures and
only Chromium can load a Chrome extension at all.

Create `playwright.extension.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// Deliberately standalone: no webServer (these tests load file:// fixtures and
// must not boot the dev stack) and chromium only (extensions do not load in
// firefox or webkit).
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /extension-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results-extension',
  timeout: 60_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

In `playwright.config.ts`, stop the default run from picking these up — add
alongside `testDir`:

```ts
  testIgnore: /extension-.*\.spec\.ts/,
```

In `package.json` `scripts`, add:

```json
    "test:extension": "pnpm run build:extension && playwright test -c playwright.extension.config.ts",
```

- [ ] **Step 5b: Write the failing E2E test**

Create `tests/e2e/extension-gate.spec.ts`:

```ts
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = join(here, '..', '..', 'extension', 'dist');
const fixture = (name: string) =>
  pathToFileURL(join(here, 'fixtures', name)).href;

let context: BrowserContext;

test.beforeAll(async () => {
  // Extensions require a persistent context and a headed-capable channel.
  context = await chromium.launchPersistentContext('', {
    args: [`--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
  });
});

test.afterAll(async () => {
  await context.close();
});

async function reportFor(url: string) {
  const page = await context.newPage();
  await page.goto(url);
  const raw = await page.waitForFunction(
    () => document.documentElement.dataset['uglyFact'] ?? null,
    undefined,
    { timeout: 10_000 },
  );
  const json = (await raw.jsonValue()) as string;
  await page.close();
  return JSON.parse(json) as {
    verdict: { engage: boolean; stop: string | null; reason: string };
    rating: { name: string } | null;
    host: string;
  };
}

test('engages on an article fixture', async () => {
  const report = await reportFor(fixture('article.html'));
  expect(report.verdict.engage).toBe(true);
  expect(report.verdict.stop).toBeNull();
});

test('stays dormant on a product page that also claims to be an article', async () => {
  const report = await reportFor(fixture('product.html'));
  expect(report.verdict.engage).toBe(false);
  expect(report.verdict.stop).toBe('commerce');
  expect(report.verdict.reason.length).toBeGreaterThan(0);
});
```

- [ ] **Step 6: Run the E2E test against the STALE build to verify it fails**

Do **not** rebuild first — `extension/dist/` still holds Task 1's placeholder
content script, which never sets `dataset.uglyFact`.

Run: `pnpm exec playwright test -c playwright.extension.config.ts`
Expected: FAIL — both tests time out waiting for `dataset.uglyFact`.

- [ ] **Step 7: Rebuild and run to verify it passes**

Run: `pnpm run test:extension`
Expected: PASS, 2 tests.

- [ ] **Step 8: Verify lint and types**

Run: `pnpm exec tsc --noEmit && pnpm run lint`
Expected: no errors. If lint complains that `extension/**` is not in a project, re-check Task 1 Step 2.

- [ ] **Step 9: Commit**

```bash
git add extension/src/content extension/src/shared tests/e2e \
        playwright.extension.config.ts playwright.config.ts package.json
git commit -m "feat(extension): DOM probe and gate-running content script"
```

---

### Task 6: Background worker and action badge

**Files:**
- Modify: `extension/src/background/index.ts`
- Create: `extension/src/shared/badge.ts`
- Test: `tests/unit/news/fact-badge.test.ts`
- Modify: `vitest.config.ts` (include `extension/src/shared` in coverage)

**Interfaces:**
- Consumes: `PageReport`, `PAGE_REPORT` from `extension/src/shared/messages`.
- Produces: `function badgeFor(report: PageReport): { text: string; color: string; title: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/news/fact-badge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { badgeFor, BADGE_DORMANT, BADGE_ENGAGED } from '../../../extension/src/shared/badge';
import type { PageReport } from '../../../extension/src/shared/messages';

const engaged: PageReport = {
  verdict: { engage: true, stop: null, reason: 'ok' },
  rating: {
    id: 'fox', name: 'Fox News', bias: 'right', biasScore: 3.5,
    factuality: 'mixed', owner: 'Fox Corporation', country: 'US',
  },
  host: 'foxnews.com',
};

describe('badgeFor', () => {
  it('marks an engaged rated page with the engaged colour', () => {
    const b = badgeFor(engaged);
    expect(b.color).toBe(BADGE_ENGAGED);
    expect(b.title).toContain('Fox News');
  });

  it('names the publisher rating in the title', () => {
    expect(badgeFor(engaged).title).toContain('mixed');
  });

  it('marks a dormant page with the dormant colour and no text', () => {
    const b = badgeFor({
      ...engaged,
      verdict: { engage: false, stop: 'commerce', reason: 'product listing' },
    });
    expect(b.color).toBe(BADGE_DORMANT);
    expect(b.text).toBe('');
    expect(b.title).toContain('Dormant');
  });

  it('handles an engaged page from an unrated publisher', () => {
    const b = badgeFor({ ...engaged, rating: null });
    expect(b.color).toBe(BADGE_ENGAGED);
    expect(b.title).toContain('Unrated');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/news/fact-badge.test.ts`
Expected: FAIL — cannot resolve `extension/src/shared/badge`.

- [ ] **Step 3: Write the implementation**

Create `extension/src/shared/badge.ts`:

```ts
import type { PageReport } from './messages';

export const BADGE_ENGAGED = '#e8590c';
export const BADGE_DORMANT = '#9b917f';

export interface BadgeState {
  text: string;
  color: string;
  title: string;
}

/**
 * Dormant must be visible, never silent — a user who thinks the feature is
 * broken has been failed more thoroughly than one who disagrees with it.
 */
export function badgeFor(report: PageReport): BadgeState {
  if (!report.verdict.engage) {
    return {
      text: '',
      color: BADGE_DORMANT,
      title: `Dormant — ${report.verdict.reason}`,
    };
  }
  const r = report.rating;
  if (r === null) {
    return {
      text: '?',
      color: BADGE_ENGAGED,
      title: `Unrated publisher — ${report.host}`,
    };
  }
  return {
    text: '',
    color: BADGE_ENGAGED,
    title: `${r.name} — ${r.bias} ${r.biasScore >= 0 ? '+' : ''}${String(r.biasScore)}, ${r.factuality} factuality`,
  };
}
```

- [ ] **Step 4: Wire the background worker**

Replace `extension/src/background/index.ts`:

```ts
import { badgeFor } from '../shared/badge';
import { PAGE_REPORT, type PageReportMessage } from '../shared/messages';
import type { PageReport } from '../shared/messages';

// Last report per tab, so the popup can render without re-probing the page.
const reports = new Map<number, PageReport>();

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const msg = message as Partial<PageReportMessage>;
  if (msg.type !== PAGE_REPORT || msg.report === undefined) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  reports.set(tabId, msg.report);
  const badge = badgeFor(msg.report);
  void chrome.action.setBadgeText({ tabId, text: badge.text });
  void chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  void chrome.action.setTitle({ tabId, title: badge.title });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  reports.delete(tabId);
});

// The popup asks for the active tab's report.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if ((message as { type?: string }).type !== 'ugly-fact:get-report') return undefined;
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const id = tab?.id;
    sendResponse(id === undefined ? null : (reports.get(id) ?? null));
  })();
  return true; // keep the channel open for the async reply
});
```

- [ ] **Step 5: Add the message type**

Append to `extension/src/shared/messages.ts`:

```ts
export const GET_REPORT = 'ugly-fact:get-report' as const;

export interface GetReportMessage {
  type: typeof GET_REPORT;
}
```

Then update the background worker's second listener to use `GET_REPORT` instead of the string literal, and import it.

- [ ] **Step 6: Include the shared extension code in coverage**

In `vitest.config.ts`, extend `coverage.include`:

```ts
      include: ['shared/**', 'server/**', 'extension/src/shared/**'],
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/news/fact-badge.test.ts`
Expected: PASS, 4 tests.

Run: `pnpm exec vitest run --coverage`
Expected: PASS with thresholds met.

- [ ] **Step 8: Verify the build and reload in Chrome**

Run: `pnpm run build:extension && pnpm exec tsc --noEmit`
Expected: no errors.

Manually: reload the unpacked extension, open the article fixture — the action title should read the publisher rating; open the product fixture — it should read `Dormant — This is a product listing…`.

- [ ] **Step 9: Commit**

```bash
git add extension/src/background extension/src/shared tests/unit/news/fact-badge.test.ts vitest.config.ts
git commit -m "feat(extension): background worker and action badge state"
```

---

### Task 7: Popup — source card and gate ladder

**Files:**
- Modify: `extension/src/popup/index.ts`
- Modify: `extension/src/popup/popup.html`
- Create: `extension/src/popup/popup.css`
- Modify: `scripts/build-extension.mjs` (copy the CSS)

**Interfaces:**
- Consumes: `GET_REPORT`, `PageReport` from `extension/src/shared/messages`.
- Produces: the rendered popup. No new exports.

- [ ] **Step 1: Write the stylesheet**

Create `extension/src/popup/popup.css` — the Studio paper palette, so the popup reads as ours:

```css
:root {
  --bg: #e7e1d5; --fg: #221c14; --orange: #e8590c; --raise: #f4efe6;
  --dim: #6b6152; --faint: #9b917f; --line: rgba(120, 105, 80, 0.22);
  --sunk: rgba(120, 105, 80, 0.1); --c2: #2f9e44; --red: #e03131;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15120e; --fg: #ece4d6; --orange: #ff6a1f; --raise: #221c15;
    --dim: #a89a84; --faint: #756a58; --line: rgba(255, 240, 210, 0.14);
    --sunk: rgba(255, 240, 210, 0.06); --c2: #51cf66; --red: #ff6b6b;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; width: 320px; padding: 14px;
  font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; background: var(--bg); color: var(--fg);
}
.card { display: flex; gap: 11px; align-items: flex-start; }
.glyph {
  width: 34px; height: 34px; border-radius: 9px; flex: none; display: grid;
  place-items: center; font-weight: 800; font-size: 14px; color: #fff;
}
.nm { font-weight: 700; font-size: 14px; }
.meta { font-size: 10px; color: var(--dim); margin-top: 3px; line-height: 1.5; }
.pill {
  display: inline-block; font-size: 8.5px; letter-spacing: 0.12em;
  text-transform: uppercase; border-radius: 4px; padding: 2px 6px; font-weight: 700;
}
.lab {
  font-size: 8.5px; letter-spacing: 0.19em; text-transform: uppercase;
  color: var(--faint); display: flex; align-items: center; gap: 8px; margin: 14px 0 8px;
}
.lab::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.why {
  font-size: 11px; line-height: 1.55; background: var(--sunk);
  border-radius: 8px; padding: 9px 11px; color: var(--dim);
}
.row {
  display: flex; gap: 9px; align-items: center; font-size: 10px;
  padding: 7px 9px; background: var(--sunk); border-radius: 7px;
  margin-bottom: 5px; color: var(--dim);
}
.row .k { flex: 1; }
.row .v { font-weight: 700; font-size: 9px; letter-spacing: 0.09em; text-transform: uppercase; }
.row.pass .v { color: var(--c2); }
.row.stop .v { color: var(--red); }
.row.skip .v { color: var(--faint); }
```

- [ ] **Step 2: Reference the stylesheet**

Replace `extension/src/popup/popup.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Ugly Fact Checker</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Copy the CSS in the build**

In `scripts/build-extension.mjs`, after the existing `copyFile` for `popup.html`, add:

```js
await copyFile(join(src, 'popup', 'popup.css'), join(out, 'popup.css'));
```

- [ ] **Step 4: Render the popup**

Replace `extension/src/popup/index.ts`:

```ts
import type { Bias } from '../../../shared/news/schemas';
import { GET_REPORT, type PageReport } from '../shared/messages';

// Keyed by the full Bias union so adding a bias value is a compile error here,
// not a silently-grey chip. Anchored on newsUi's left/center/right constants.
const BIAS_COLOR: Record<Bias, string> = {
  'far-left': '#1d2a4d',
  left: '#2a3b6b',
  'lean-left': '#4a5a8a',
  center: '#9a9082',
  'lean-right': '#c05a4a',
  right: '#d6261d',
  'far-right': '#9e1a12',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function sourceCard(report: PageReport): string {
  const r = report.rating;
  if (r === null) {
    return `<div class="card"><div class="glyph" style="background:var(--faint)">?</div>
      <div><div class="nm">Unrated source</div>
      <div class="meta">${escapeHtml(report.host)}<br>No published reliability rating.</div>
      </div></div>`;
  }
  const color = BIAS_COLOR[r.bias];
  const sign = r.biasScore >= 0 ? '+' : '';
  return `<div class="card">
    <div class="glyph" style="background:${color}">${escapeHtml(r.name.slice(0, 1))}</div>
    <div>
      <div class="nm">${escapeHtml(r.name)}</div>
      <div class="meta">
        <span class="pill" style="background:color-mix(in srgb, ${color} 18%, transparent);color:${color}">
          ${escapeHtml(r.bias)} ${sign}${String(r.biasScore)}</span>
        factuality: <b>${escapeHtml(r.factuality)}</b><br>
        ${escapeHtml(r.owner ?? 'Unknown owner')}${r.country === null ? '' : ' · ' + escapeHtml(r.country)}
      </div>
    </div></div>`;
}

function ladder(report: PageReport): string {
  const engaged = report.verdict.engage;
  const rows: Array<[string, string, string]> = [
    ['Tier 0 · page shape', engaged ? 'pass' : 'stop', engaged ? 'Article' : 'Stopped'],
    [
      'Tier 1 · publisher',
      engaged ? (report.rating === null ? 'skip' : 'pass') : 'skip',
      engaged ? (report.rating === null ? 'Unrated' : 'Rated') : 'Skipped',
    ],
    ['Tier 2 · corpus', 'skip', 'Not in this build'],
    ['Tier 3 · claims', 'skip', 'Not in this build'],
  ];
  return rows
    .map(
      ([k, cls, v]) =>
        `<div class="row ${cls}"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`,
    )
    .join('');
}

async function render(): Promise<void> {
  const root = document.getElementById('root');
  if (root === null) return;

  const report = (await chrome.runtime.sendMessage({ type: GET_REPORT })) as PageReport | null;

  if (report === null) {
    root.innerHTML = `<div class="why">No reading for this tab yet. Reload the page and try again.</div>`;
    return;
  }

  root.innerHTML =
    sourceCard(report) +
    `<div class="lab">${report.verdict.engage ? 'Status' : 'Dormant'}</div>` +
    `<div class="why">${escapeHtml(report.verdict.reason)}</div>` +
    `<div class="lab">The gate</div>` +
    ladder(report);
}

void render();
```

- [ ] **Step 5: Build and verify manually**

Run: `pnpm run build:extension && pnpm exec tsc --noEmit && pnpm run lint`
Expected: no errors.

Manually: reload the unpacked extension.
- Open `tests/e2e/fixtures/article.html` → popup shows "Unrated source" (a `file://` host is not in the registry), status "Status", and the ladder with Tier 0 = Article.
- Open `https://www.bbc.com/news` → popup shows the BBC card with `center −0.5`, factuality `high`, owner and country.
- Open `tests/e2e/fixtures/product.html` → popup shows "Dormant" and the product-listing reason, Tier 0 = Stopped.

- [ ] **Step 6: Commit**

```bash
git add extension/src/popup scripts/build-extension.mjs
git commit -m "feat(extension): popup source card and gate ladder"
```

---

## Done when

- `pnpm run build:extension` produces a `extension/dist/` that Chrome loads with no errors.
- `pnpm exec vitest run --coverage` passes with thresholds met.
- `pnpm run test:extension` passes.
- `pnpm exec tsc --noEmit && pnpm run lint` are clean.
- Visiting a rated news site shows the publisher's bias and factuality in the popup with **zero network requests from the extension** (verify in DevTools → Network, filtered to the extension).

## Deliberately not in this step

- The `domainBias` table (~3,875 domains) — not committed to this repo; needs a separate generator that reads prod D1.
- Any `factSpread` / `factQuick` / `factChallenge` endpoint, claim segmentation, highlighting, or the Ugly Extension Runtime hosts.
- Extension icons.
