import {
  buildSelector,
  resolveSelector,
} from '../../../shared/news/fact-anchor';
import { classifyPage } from '../../../shared/news/fact-gate';
import { lookupRating } from '../../../shared/news/fact-registry';
import { BUNDLED_REGISTRY } from '../generated/registry';
import { installConsoleCapture } from '../shared/console-capture';
import { ConsoleRing } from '../shared/console-ring';
import {
  CLAIMS_DONE,
  FETCH_CLAIMS,
  FETCH_QUICK,
  GET_LOGS,
  PAGE_REPORT,
  REPORT_ERROR,
  SET_STATUS,
  type ClaimsDoneMessage,
  type ReportErrorMessage,
  type ClaimsOutcome,
  type ClaimsResult,
  type FetchClaimsMessage,
  type FetchQuickMessage,
  type QuickResult,
  type QuickVerdict,
  type PageReport,
  type PageReportMessage,
  type SetStatusMessage,
} from '../shared/messages';
import {
  claimAtPoint,
  highlightsSupported,
  paintClaims,
  setBand,
  type Band,
} from './highlight';
import { closePopover, openPopover } from './popover';
import { readPageSignals } from './probe';
import { buildTextMap } from './text-map';

// Captures the extension's OWN logging in this isolated world — the gate
// verdict, the endpoint's reply, every claim that failed to anchor. The host
// page's console is deliberately not read: that would need a main-world
// injection, which is a real privilege increase for no diagnostic gain.
const ring = new ConsoleRing();

installConsoleCapture({
  target: console,
  ring,
  onError: (entry) => {
    const msg: ReportErrorMessage = {
      type: REPORT_ERROR,
      entry: { ...entry, source: 'extension-content', url: location.href },
    };
    void chrome.runtime.sendMessage(msg).catch(() => undefined);
  },
});

// The background asks for this only when a report is actually filed.
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if ((message as { type?: string }).type !== GET_LOGS) return undefined;
    sendResponse(ring.snapshot());
    return true;
  },
);

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

/**
 * Report what the claims pass achieved, for every outcome. Silence here is what
 * made an unregistered prod route look like an article with nothing to check.
 */
function reportClaims(outcome: ClaimsOutcome): void {
  console.log('[ugly-fact] claims outcome', outcome);
  document.documentElement.dataset.uglyFactClaims = String(outcome.painted);
  document.documentElement.dataset.uglyFactOutcome = JSON.stringify(outcome);
  const msg: ClaimsDoneMessage = { type: CLAIMS_DONE, outcome };
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
}

/** Tier 3: one model call for the whole article, then anchor and paint. */
async function checkClaims(): Promise<void> {
  const root = document.querySelector('article') ?? document.body;
  if (!(root instanceof HTMLElement)) return;
  // The getClientRects overlay fallback is a later task; without highlight
  // support we simply do not paint rather than degrading to something worse.
  if (!highlightsSupported()) {
    reportClaims({ returned: 0, painted: 0, error: 'no CSS Highlight API' });
    return;
  }

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
    const status: SetStatusMessage = {
      type: SET_STATUS,
      status: result.status,
    };
    void chrome.runtime.sendMessage(status).catch(() => undefined);
    return;
  }
  if (result.error !== null) {
    reportClaims({ returned: 0, painted: 0, error: result.error });
    return;
  }
  if (result.claims.length === 0) {
    reportClaims({ returned: 0, painted: 0, error: null });
    return;
  }

  const entries: { id: string; range: Range; band: Band; text: string }[] = [];
  let cursor = 0;
  for (const [i, claim] of result.claims.entries()) {
    if (!claim.checkable) continue;
    const sel = buildSelector(map.text, claim.text, cursor);
    // Anchoring failures are the quiet killer — a claim that will not resolve
    // simply vanishes, so each one says why and quotes the text it could not
    // find. This is what a "it missed claims" report needs to be answerable.
    if (sel === null) {
      console.log('[ugly-fact] unanchored (not in page text)', claim.text);
      continue;
    }
    const hit = resolveSelector(map.text, sel);
    if (hit === null) {
      console.log('[ugly-fact] unanchored (selector unresolved)', claim.text);
      continue;
    }
    // Advance so a repeated sentence anchors to its NEXT occurrence rather
    // than painting the first one twice. Must come from the resolved hit — a
    // literal indexOf misses whenever whitespace differs.
    cursor = hit.start + 1;
    const range = map.toRange(hit.start, hit.end);
    // A claim that will not anchor is DROPPED — a misplaced highlight is worse
    // than a missing one.
    if (range === null) {
      console.log('[ugly-fact] unanchored (no DOM range)', claim.text);
      continue;
    }
    entries.push({
      id: `c${String(i)}`,
      range,
      band: 'pending',
      text: claim.text,
    });
  }

  paintClaims(entries);
  // `returned` counts only checkable claims — the ones we ever intended to
  // anchor — so the ratio measures anchoring, not the model's classification.
  const checkable = result.claims.filter((c) => c.checkable).length;
  reportClaims({ returned: checkable, painted: entries.length, error: null });

  await colourClaims(entries.map((e) => ({ id: e.id, text: e.text })));
}

/** What the popover shows for each painted claim, once verdicts arrive. */
const verdicts = new Map<string, QuickVerdict & { text: string }>();

/** `unverified` is a distinct STATE, not a missing verdict — hence grey. */
function bandFor(v: QuickVerdict): Band {
  return v.band === 'unverified' ? 'grey' : v.band;
}

/** Tier 2 + 3: resolve every pending tint to a colour. */
async function colourClaims(
  claims: { id: string; text: string }[],
): Promise<void> {
  if (claims.length === 0) return;
  const message: FetchQuickMessage = { type: FETCH_QUICK, claims };
  const result: QuickResult = await chrome.runtime.sendMessage(message);

  if (result.status !== 'ok') {
    document.documentElement.dataset.uglyFactStatus = result.status;
    const status: SetStatusMessage = {
      type: SET_STATUS,
      status: result.status,
    };
    void chrome.runtime.sendMessage(status).catch(() => undefined);
    return;
  }
  if (result.error !== null) {
    console.error(`[ugly-fact] verdicts failed: ${result.error}`);
    return;
  }

  const byId = new Map(claims.map((c) => [c.id, c.text]));
  for (const v of result.verdicts) {
    const text = byId.get(v.id);
    if (text === undefined) continue;
    verdicts.set(v.id, { ...v, text });
    setBand(v.id, bandFor(v));
  }
  console.log(`[ugly-fact] coloured ${String(result.verdicts.length)} claims`);
  document.documentElement.dataset.uglyFactVerdicts = String(
    result.verdicts.length,
  );
}

// Highlights are not hit-testable, so a click resolves through the caret
// position against the stored ranges rather than through an event target.
document.addEventListener('click', (e) => {
  const id = claimAtPoint(e.clientX, e.clientY);
  if (id === null) {
    closePopover();
    return;
  }
  const v = verdicts.get(id);
  if (v === undefined) return;
  openPopover(
    {
      text: v.text,
      band: bandFor(v),
      forcedYellowReason: v.forcedYellowReason,
      counted: v.counted,
      sources: v.sources,
    },
    e.clientX,
    e.clientY,
  );
});

function run(): void {
  const r = report();
  console.log(
    '[ugly-fact] gate',
    r.verdict,
    'host',
    r.host,
    'rated',
    r.rating !== null,
  );
  const message: PageReportMessage = { type: PAGE_REPORT, report: r };
  // The worker may be asleep; a failed send is not worth surfacing.
  void chrome.runtime.sendMessage(message).catch(() => undefined);
  // Exposed so the E2E test can read the verdict without reaching into the
  // extension's own world.
  document.documentElement.dataset.uglyFact = JSON.stringify(r);

  // A rejection here used to vanish, leaving the popup on "Running" forever —
  // indistinguishable from a live call. Every failure now reports itself.
  if (r.verdict.engage) {
    void checkClaims().catch((e: unknown) => {
      console.error('[ugly-fact] claims pass threw', e);
      reportClaims({ returned: 0, painted: 0, error: String(e) });
    });
  }
}

if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => {
    run();
  });
} else {
  setTimeout(run, 0);
}
