import { classifyPage } from '../../../shared/news/fact-gate';
import { lookupRating } from '../../../shared/news/fact-registry';
import { BUNDLED_REGISTRY } from '../generated/registry';
import {
  PAGE_REPORT,
  type PageReport,
  type PageReportMessage,
} from '../shared/messages';
import { readPageSignals } from './probe';

// Tier 0 + tier 1 only: read the DOM we already have, and one map lookup.
// No network, no model call. Runs on idle so it never competes with the
// site's own scripts during load.
function run(): void {
  const host = location.hostname;
  const report: PageReport = {
    verdict: classifyPage(readPageSignals(document)),
    rating: lookupRating(host, BUNDLED_REGISTRY),
    host,
  };
  const message: PageReportMessage = { type: PAGE_REPORT, report };
  // The worker may be asleep; a failed send is not worth surfacing.
  void chrome.runtime.sendMessage(message).catch(() => undefined);
  // Exposed so the E2E test can read the verdict without reaching into the
  // extension's own world.
  document.documentElement.dataset.uglyFact = JSON.stringify(report);
}

if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => {
    run();
  });
} else {
  setTimeout(run, 0);
}
