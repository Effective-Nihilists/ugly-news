import { buildSelector, resolveSelector } from '../../../shared/news/fact-anchor';
import { classifyPage } from '../../../shared/news/fact-gate';
import { lookupRating } from '../../../shared/news/fact-registry';
import { BUNDLED_REGISTRY } from '../generated/registry';
import {
  FETCH_CLAIMS,
  PAGE_REPORT,
  SET_STATUS,
  type ClaimsResult,
  type FetchClaimsMessage,
  type PageReport,
  type PageReportMessage,
  type SetStatusMessage,
} from '../shared/messages';
import { highlightsSupported, paintClaims, type Band } from './highlight';
import { readPageSignals } from './probe';
import { buildTextMap } from './text-map';

/**
 * Tier 0 + tier 1: read the DOM we already have, and one map lookup.
 * No network, no model call. Runs on idle so it never competes with the site's
 * own scripts during load.
 */
function report(): PageReport {
  const host = location.hostname;
  return {
    verdict: classifyPage(readPageSignals(document)),
    rating: lookupRating(host, BUNDLED_REGISTRY),
    host,
  };
}

/** Tier 3: one model call for the whole article, then anchor and paint. */
async function checkClaims(): Promise<void> {
  const root = document.querySelector('article') ?? document.body;
  if (!(root instanceof HTMLElement)) return;
  // The getClientRects overlay fallback is a later task; without highlight
  // support we simply do not paint rather than degrading to something worse.
  if (!highlightsSupported()) return;

  const map = buildTextMap(root);
  const message: FetchClaimsMessage = {
    type: FETCH_CLAIMS,
    url: location.href,
    title: document.title,
    text: map.text,
  };
  const result: ClaimsResult = await chrome.runtime.sendMessage(message);

  if (result.status !== 'ok') {
    // Neither state is a failure the user can do nothing about — record it so
    // the badge and the popup can offer the right remedy.
    document.documentElement.dataset.uglyFactStatus = result.status;
    const status: SetStatusMessage = { type: SET_STATUS, status: result.status };
    void chrome.runtime.sendMessage(status).catch(() => undefined);
    return;
  }
  if (result.error !== null || result.claims.length === 0) return;

  const entries: { id: string; range: Range; band: Band }[] = [];
  let cursor = 0;
  for (const [i, claim] of result.claims.entries()) {
    if (!claim.checkable) continue;
    const sel = buildSelector(map.text, claim.text, cursor);
    if (sel === null) continue;
    const hit = resolveSelector(map.text, sel);
    if (hit === null) continue;
    // Advance so a repeated sentence anchors to its NEXT occurrence rather
    // than painting the first one twice. Must come from the resolved hit — a
    // literal indexOf misses whenever whitespace differs.
    cursor = hit.start + 1;
    const range = map.toRange(hit.start, hit.end);
    // A claim that will not anchor is DROPPED — a misplaced highlight is worse
    // than a missing one.
    if (range === null) continue;
    entries.push({ id: `c${String(i)}`, range, band: 'pending' });
  }

  paintClaims(entries);
  document.documentElement.dataset.uglyFactClaims = String(entries.length);
}

function run(): void {
  const r = report();
  const message: PageReportMessage = { type: PAGE_REPORT, report: r };
  // The worker may be asleep; a failed send is not worth surfacing.
  void chrome.runtime.sendMessage(message).catch(() => undefined);
  // Exposed so the E2E test can read the verdict without reaching into the
  // extension's own world.
  document.documentElement.dataset.uglyFact = JSON.stringify(r);

  if (r.verdict.engage) void checkClaims();
}

if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => {
    run();
  });
} else {
  setTimeout(run, 0);
}
