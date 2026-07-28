import { badgeFor, badgeForStatus } from '../shared/badge';
import { installConsoleCapture } from '../shared/console-capture';
import { ConsoleRing, type LogEntry } from '../shared/console-ring';
import { createErrorBatcher } from '../shared/error-batcher';
import { buildFeedbackReport, MAX_SHIPPED_LOGS } from '../shared/feedback';
import { sendErrors, sendFeedback } from './telemetry';
import {
  GET_LOGS,
  REPORT_ERROR,
  SEND_FEEDBACK,
  type GetLogsMessage,
  type ReportErrorMessage,
  type SendFeedbackMessage,
  type SendFeedbackResult,
} from '../shared/messages';
import {
  CLAIMS_DONE,
  FETCH_CLAIMS,
  GET_REPORT,
  OPEN_URL,
  PAGE_REPORT,
  SET_STATUS,
  type ClaimsDoneMessage,
  type ClaimsOutcome,
  type ClaimsResult,
  type FactStatus,
  type FetchClaimsMessage,
  type OpenUrlMessage,
  type PageReport,
  type PageReportMessage,
  type SetStatusMessage,
} from '../shared/messages';

const API_BASE = 'https://ugly.press/api';

// Per-tab state, so the popup can render without re-probing the page.
// Deliberately in-memory: this is per-session UI state.
const reports = new Map<number, PageReport>();
const statuses = new Map<number, FactStatus>();
const outcomes = new Map<number, ClaimsOutcome>();

// The worker's own console history — this is where the endpoint's replies are
// logged, so it holds the answer to most "why did nothing happen" questions.
const ring = new ConsoleRing();

const errors = createErrorBatcher({
  send: (entries) => sendErrors(entries, ring.snapshot(MAX_SHIPPED_LOGS)),
  delayMs: 3000,
  maxBatch: 20,
});

installConsoleCapture({
  target: console,
  ring,
  onError: (e) => {
    errors.add({ ...e, source: 'extension-background' });
  },
});

function applyBadge(tabId: number): void {
  const status = statuses.get(tabId) ?? 'ok';
  const blocked = badgeForStatus(status);
  const report = reports.get(tabId);
  const badge = blocked ?? (report === undefined ? null : badgeFor(report));
  if (badge === null) return;
  void chrome.action.setBadgeText({ tabId, text: badge.text });
  void chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  void chrome.action.setTitle({ tabId, title: badge.title });
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const msg = message as Partial<PageReportMessage>;
  if (msg.type !== PAGE_REPORT || msg.report === undefined) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  reports.set(tabId, msg.report);
  statuses.delete(tabId); // a fresh navigation clears any prior block
  outcomes.delete(tabId); // ...and any prior claim result
  applyBadge(tabId);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const msg = message as Partial<ClaimsDoneMessage>;
  if (msg.type !== CLAIMS_DONE || msg.outcome === undefined) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  outcomes.set(tabId, msg.outcome);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const msg = message as Partial<SetStatusMessage>;
  if (msg.type !== SET_STATUS || msg.status === undefined) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  statuses.set(tabId, msg.status);
  applyBadge(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  reports.delete(tabId);
  statuses.delete(tabId);
});

// The popup asks for the active tab's report and status.
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if ((message as { type?: string }).type !== GET_REPORT) return undefined;
    void (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const id = tab?.id;
      if (id === undefined) {
        sendResponse(null);
        return;
      }
      sendResponse({
        report: reports.get(id) ?? null,
        status: statuses.get(id) ?? 'ok',
        outcome: outcomes.get(id) ?? null,
      });
    })();
    return true; // keep the channel open for the async reply
  },
);

/**
 * Claim fetching happens HERE, not in the content script.
 *
 * ugly.press sets no access-control-* headers and 404s OPTIONS, so a content
 * script's cross-origin POST would be blocked. An extension service worker with
 * host_permissions is exempt from CORS and — verified — sends the origin's
 * cookies, which is both the auth and the AI billing identity.
 */
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as Partial<FetchClaimsMessage>;
    if (msg.type !== FETCH_CLAIMS) return undefined;
    void (async () => {
      const fail = (status: FactStatus, error: string | null): void => {
        const out: ClaimsResult = { claims: [], error, status };
        sendResponse(out);
      };
      try {
        const res = await fetch(`${API_BASE}/factClaims`, {
          method: 'POST',
          // REQUIRED: carries the ugly.press session cookie. Without it every
          // call is a 401.
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: {
              url: msg.url ?? '',
              title: msg.title ?? '',
              text: msg.text ?? '',
            },
          }),
        });
        // authReq() 401s before the handler runs — this is the no-session case.
        if (res.status === 401) {
          fail('signed-out', null);
          return;
        }
        if (!res.ok) {
          // The body is where the real answer lives — an unregistered route
          // says so in plain words, and discarding it cost an afternoon.
          const detail = await res.text().catch(() => '');
          const trimmed = detail.slice(0, 200).trim();
          fail(
            'ok',
            `HTTP ${String(res.status)}${trimmed === '' ? '' : ` ${trimmed}`}`,
          );
          return;
        }
        const body = (await res.json()) as {
          result?: { claims?: unknown; status?: unknown };
        };
        const claims = Array.isArray(body.result?.claims)
          ? (body.result.claims as ClaimsResult['claims'])
          : [];
        const status =
          body.result?.status === 'signed-out' ||
          body.result?.status === 'no-credit'
            ? body.result.status
            : 'ok';
        const out: ClaimsResult = { claims, error: null, status };
        sendResponse(out);
      } catch (e) {
        fail('ok', String(e));
      }
    })();
    return true;
  },
);

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as Partial<OpenUrlMessage>;
  if (msg.type !== OPEN_URL || msg.url === undefined) return;
  void chrome.tabs.create({ url: msg.url });
});

// Content scripts and the popup cannot reach ugly.press directly, so their
// console.error arrives here to be batched with the worker's own.
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const msg = message as Partial<ReportErrorMessage>;
  if (msg.type !== REPORT_ERROR || msg.entry === undefined) return;
  errors.add({
    ...msg.entry,
    ...(sender.tab?.url === undefined ? {} : { url: sender.tab.url }),
  });
});

/** The content script's history, which is where the gate and anchoring log. */
async function contentLogs(tabId: number): Promise<LogEntry[]> {
  try {
    const msg: GetLogsMessage = { type: GET_LOGS };
    const reply: unknown = await chrome.tabs.sendMessage(tabId, msg);
    return Array.isArray(reply) ? (reply as LogEntry[]) : [];
  } catch {
    // No content script on this tab (or it died) — a report without page logs
    // still beats no report.
    return [];
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as Partial<SendFeedbackMessage>;
    if (msg.type !== SEND_FEEDBACK || msg.kind === undefined) return undefined;
    // Bound before the closure — narrowing does not survive into the IIFE.
    const kind = msg.kind;
    void (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const id = tab?.id;
      const logs = id === undefined ? [] : await contentLogs(id);
      // Both histories, in time order — the worker logged the HTTP reply, the
      // content script logged the gate and the anchoring.
      const merged = [...logs, ...ring.snapshot()].sort(
        (a, b) => a.timestamp - b.timestamp,
      );
      const report = buildFeedbackReport({
        kind,
        description: msg.description ?? '',
        url: tab?.url ?? '',
        title: tab?.title ?? '',
        report: id === undefined ? null : (reports.get(id) ?? null),
        outcome: id === undefined ? null : (outcomes.get(id) ?? null),
        logs: merged,
        userAgent: msg.userAgent ?? '',
        screenWidth: msg.screenWidth ?? 0,
        screenHeight: msg.screenHeight ?? 0,
        version: chrome.runtime.getManifest().version,
      });
      const result: SendFeedbackResult = await sendFeedback(report);
      sendResponse(result);
    })();
    return true;
  },
);
