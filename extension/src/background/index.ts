import { badgeFor } from '../shared/badge';
import {
  GET_REPORT,
  PAGE_REPORT,
  type PageReport,
  type PageReportMessage,
} from '../shared/messages';

// Last report per tab, so the popup can render without re-probing the page.
// Deliberately in-memory: this is per-session UI state, not something worth
// persisting, and the background is stateless across restarts by design.
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
chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if ((message as { type?: string }).type !== GET_REPORT) return undefined;
    void (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const id = tab?.id;
      sendResponse(id === undefined ? null : (reports.get(id) ?? null));
    })();
    return true; // keep the channel open for the async reply
  },
);
