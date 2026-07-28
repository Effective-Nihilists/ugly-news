import {
  buildSelector,
  resolveSelector,
} from '../../../shared/news/fact-anchor';
import { classifyPage } from '../../../shared/news/fact-gate';
import { pickNonOverlapping } from '../../../shared/news/fact-overlap';
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
import { closePopover, isPopoverEvent, openPopover } from './popover';
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
  // A FAILURE goes to console.error so it reaches error telemetry. Only
  // colourClaims did this at first, which is why the prod log showed the
  // verdict failure and stayed silent about whether claims had failed too.
  if (outcome.error !== null) {
    console.error(`[ugly-fact] claims failed: ${outcome.error}`);
  }
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

  // Resolve every claim to offsets FIRST, then settle overlaps, then build
  // ranges. An exhaustive extractor emits the sentence and the statistic inside
  // it; both are real claims, but only one can own those words on screen.
  const located: { id: string; start: number; end: number; text: string }[] =
    [];
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
    located.push({
      id: `c${String(i)}`,
      start: hit.start,
      end: hit.end,
      text: claim.text,
    });
  }

  const winners = pickNonOverlapping(located);
  const nested = located.length - winners.length;
  if (nested > 0) {
    console.log(`[ugly-fact] dropped ${String(nested)} overlapping claims`);
  }

  const entries: { id: string; range: Range; band: Band; text: string }[] = [];
  for (const w of winners) {
    const range = map.toRange(w.start, w.end);
    // A claim that will not anchor is DROPPED — a misplaced highlight is worse
    // than a missing one.
    if (range === null) {
      console.log('[ugly-fact] unanchored (no DOM range)', w.text);
      continue;
    }
    entries.push({ id: w.id, range, band: 'pending', text: w.text });
    claimText.set(w.id, w.text);
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

/**
 * The server caps ONE request so its fan-out stays inside the proxy timeout.
 * Chunking here is what makes that a per-request limit instead of a silent
 * per-page one that leaves later claims grey forever.
 */
const QUICK_CHUNK = 10;

/** Tier 2 + 3: resolve every pending tint to a colour. */
async function colourClaims(
  claims: { id: string; text: string }[],
): Promise<void> {
  if (claims.length === 0) return;
  const byId = new Map(claims.map((c) => [c.id, c.text]));
  let coloured = 0;

  for (let i = 0; i < claims.length; i += QUICK_CHUNK) {
    const chunk = claims.slice(i, i + QUICK_CHUNK);
    const message: FetchQuickMessage = { type: FETCH_QUICK, claims: chunk };
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
      // Report and STOP: the next chunk would almost certainly fail the same
      // way, and burning the user's credit to prove it is not worth it.
      console.error(`[ugly-fact] verdicts failed: ${result.error}`);
      break;
    }

    // Applied per chunk, so a long article colours progressively instead of
    // sitting entirely grey until the last request lands.
    for (const v of result.verdicts) {
      const text = byId.get(v.id);
      if (text === undefined) continue;
      verdicts.set(v.id, { ...v, text });
      setBand(v.id, bandFor(v));
      coloured++;
    }
    document.documentElement.dataset.uglyFactVerdicts = String(coloured);
  }

  console.log(
    `[ugly-fact] coloured ${String(coloured)} of ${String(claims.length)} claims`,
  );
}

/** Text of every painted claim, so an unchecked one can still say so. */
const claimText = new Map<string, string>();

/**
 * Open the card for a claim at a point.
 *
 * A claim with NO verdict yet still opens, saying it is being checked. It used
 * to return silently, which is why a page whose verdict call had failed felt
 * completely inert — the single most confusing state this feature can be in.
 */
function showClaim(id: string, x: number, y: number): void {
  const v = verdicts.get(id);
  if (v === undefined) {
    const text = claimText.get(id);
    if (text === undefined) return;
    openPopover(
      {
        text,
        band: 'pending',
        forcedYellowReason: null,
        counted: 0,
        sources: [],
      },
      x,
      y,
    );
    return;
  }
  openPopover(
    {
      text: v.text,
      band: bandFor(v),
      forcedYellowReason: v.forcedYellowReason,
      counted: v.counted,
      sources: v.sources,
    },
    x,
    y,
  );
}

// Highlights are not hit-testable, so a click resolves through the caret
// position against the stored ranges rather than through an event target.
document.addEventListener('click', (e) => {
  // A click inside the card is the card's business — closing it here would
  // cancel the source link the reader just clicked.
  if (isPopoverEvent(e)) return;
  const id = claimAtPoint(e.clientX, e.clientY);
  if (id === null) {
    closePopover();
    return;
  }
  showClaim(id, e.clientX, e.clientY);
});

/**
 * Hover opens the card too, which is what readers reach for first.
 *
 * Throttled, and only re-resolved when the pointer has actually moved a few
 * pixels: caretPositionFromPoint forces layout, and running it on every
 * mousemove would tax the host page for nothing.
 */
let hoverAt = 0;
let lastX = -1;
let lastY = -1;
let openFor: string | null = null;

document.addEventListener('mousemove', (e) => {
  if (isPopoverEvent(e)) return;
  const now = Date.now();
  if (now - hoverAt < 120) return;
  if (Math.abs(e.clientX - lastX) < 4 && Math.abs(e.clientY - lastY) < 4)
    return;
  hoverAt = now;
  lastX = e.clientX;
  lastY = e.clientY;

  const id = claimAtPoint(e.clientX, e.clientY);
  if (id === null) {
    // Leaving the text closes the card, but a click-opened card is left alone
    // so a reader can travel to it with the mouse.
    if (openFor !== null) {
      closePopover();
      openFor = null;
    }
    return;
  }
  if (id === openFor) return;
  openFor = id;
  showClaim(id, e.clientX, e.clientY);
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
