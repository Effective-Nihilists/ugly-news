import type { LogEntry } from '../shared/console-ring';
import type { ErrorEntry } from '../shared/error-batcher';
import type { FeedbackReport } from '../shared/feedback';

const API_BASE = 'https://ugly.press/api';

/**
 * Both endpoints are the framework's own PUBLIC telemetry requests, so an
 * extension report lands in exactly the same table as a web one and is
 * readable with the same tooling. Nothing bespoke.
 *
 * The `{ input: ... }` envelope is mandatory: `POST /api/:name` reads
 * `body.input`, and a flat body still answers 200 while writing an all-NULL
 * row — a silent loss that looks like success.
 */
async function postFramework(
  fn: string,
  input: unknown,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res = await fetch(`${API_BASE}/${fn}`, {
      method: 'POST',
      // Public endpoints, but the cookie attributes the report to the user.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200).trim();
      return {
        ok: false,
        error: `HTTP ${String(res.status)}${detail === '' ? '' : ` ${detail}`}`,
      };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function version(): string {
  return chrome.runtime.getManifest().version;
}

export async function sendErrors(
  entries: ErrorEntry[],
  logs: LogEntry[],
): Promise<void> {
  await postFramework('errorLogCaptureNoAuth', {
    entries,
    logs,
    version: version(),
  });
}

export async function sendFeedback(
  report: FeedbackReport,
): Promise<{ ok: boolean; error: string | null }> {
  return postFramework('feedbackReportCreateNoAuth', report);
}
