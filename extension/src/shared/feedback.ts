import type { LogEntry } from './console-ring';
import type { ClaimsOutcome, PageReport } from './messages';

/**
 * Builds the payload for the framework's `feedbackReportCreateNoAuth`.
 *
 * Deliberately the standard endpoint rather than a bespoke one: these reports
 * belong in the same place as every other app's, and the schema already
 * carries the two fields that make a report answerable — `logs` and `context`.
 */

export type FeedbackKindId =
  | 'should-be-news'
  | 'should-not-be-news'
  | 'missed-claims'
  | 'wrong-claim'
  | 'other';

export interface FeedbackKind {
  id: FeedbackKindId;
  label: string;
}

/** The failures a reader can actually observe, in the words they'd use. */
export const FEEDBACK_KINDS: FeedbackKind[] = [
  { id: 'should-be-news', label: 'This is news — the checker stayed dormant' },
  { id: 'should-not-be-news', label: "This isn't news — it shouldn't engage" },
  { id: 'missed-claims', label: 'It missed claims it should have flagged' },
  { id: 'wrong-claim', label: 'It flagged the wrong text' },
  { id: 'other', label: 'Something else' },
];

/** The framework caps description at 5000. */
const MAX_DESCRIPTION = 5000;

/** Recent history is what matters; the whole ring would bloat every row. */
export const MAX_SHIPPED_LOGS = 120;

export interface FeedbackInput {
  kind: FeedbackKindId;
  description: string;
  url: string;
  title: string;
  report: PageReport | null;
  outcome: ClaimsOutcome | null;
  logs: LogEntry[];
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  version: string;
}

export interface FeedbackReport {
  type: 'bug';
  description: string;
  url: string;
  page: string;
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  logs: LogEntry[];
  context: Record<string, unknown>;
  version: string;
}

function labelFor(id: FeedbackKindId): string {
  return FEEDBACK_KINDS.find((k) => k.id === id)?.label ?? id;
}

export function buildFeedbackReport(input: FeedbackInput): FeedbackReport {
  const written = input.description.trim();
  // description is REQUIRED by the framework schema; an empty box must not
  // turn into a 400 that quietly loses the report.
  const body = written === '' ? labelFor(input.kind) : written;
  const description = `[fact-checker/${input.kind}] ${body}`.slice(
    0,
    MAX_DESCRIPTION,
  );

  return {
    type: 'bug',
    description,
    url: input.url,
    // Marks the surface so extension reports are separable from the web app's.
    page: 'extension:popup',
    userAgent: input.userAgent,
    screenWidth: input.screenWidth,
    screenHeight: input.screenHeight,
    logs: input.logs.slice(-MAX_SHIPPED_LOGS),
    version: input.version,
    context: {
      kind: input.kind,
      title: input.title,
      host: input.report?.host ?? null,
      verdict: input.report?.verdict ?? null,
      rating: input.report?.rating ?? null,
      outcome: input.outcome ?? null,
    },
  };
}
