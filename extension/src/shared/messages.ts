import type { ClaimClass } from '../../../shared/news/fact-claims';
import type { GateVerdict } from '../../../shared/news/fact-gate';
import type { SourceRating } from '../../../shared/news/fact-registry';
import type { ErrorEntry } from './error-batcher';
import type { FeedbackKindId } from './feedback';

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

export const GET_REPORT = 'ugly-fact:get-report' as const;

export interface GetReportMessage {
  type: typeof GET_REPORT;
}

/**
 * Distinct states because each has a distinct remedy. Never collapse these
 * into a generic error — the popup blocks on the two actionable ones and needs
 * to know which button to show.
 */
export type FactStatus = 'ok' | 'signed-out' | 'no-credit';

export const FETCH_CLAIMS = 'ugly-fact:fetch-claims' as const;

export interface FetchClaimsMessage {
  type: typeof FETCH_CLAIMS;
  url: string;
  title: string;
  text: string;
}

export interface ClaimsResult {
  claims: { text: string; class: ClaimClass; checkable: boolean }[];
  error: string | null;
  status: FactStatus;
}

/**
 * What the claims pass actually achieved, reported for EVERY outcome including
 * the boring ones. `returned` is what the model gave us; `painted` is what
 * survived anchoring. Keeping them apart is what makes an anchoring regression
 * distinguishable from a quiet article.
 */
export interface ClaimsOutcome {
  returned: number;
  painted: number;
  error: string | null;
}

export const CLAIMS_DONE = 'ugly-fact:claims-done' as const;

export interface ClaimsDoneMessage {
  type: typeof CLAIMS_DONE;
  outcome: ClaimsOutcome;
}

export const FETCH_QUICK = 'ugly-fact:fetch-quick' as const;

export interface FetchQuickMessage {
  type: typeof FETCH_QUICK;
  claims: { id: string; text: string }[];
}

export interface QuickSource {
  name: string;
  bias: string;
  factuality: string;
  stance: 'supports' | 'refutes' | 'mixed' | 'silent';
  independence: number;
}

export interface QuickVerdict {
  id: string;
  score: number;
  band: 'green' | 'yellow' | 'red' | 'unverified';
  forcedYellowReason: 'variance' | 'single-bucket' | null;
  counted: number;
  sources: QuickSource[];
}

export interface QuickResult {
  verdicts: QuickVerdict[];
  error: string | null;
  status: FactStatus;
}

export const SET_STATUS = 'ugly-fact:set-status' as const;

export interface SetStatusMessage {
  type: typeof SET_STATUS;
  status: FactStatus;
}

/**
 * Telemetry travels content/popup → background, because the background service
 * worker is the only context exempt from CORS. A content script POSTing to
 * ugly.press from a third-party article would be blocked outright.
 */
export const REPORT_ERROR = 'ugly-fact:report-error' as const;

export interface ReportErrorMessage {
  type: typeof REPORT_ERROR;
  entry: ErrorEntry;
}

/** Background → content, on demand: the page's console history for a report. */
export const GET_LOGS = 'ugly-fact:get-logs' as const;

export interface GetLogsMessage {
  type: typeof GET_LOGS;
}

export const SEND_FEEDBACK = 'ugly-fact:send-feedback' as const;

export interface SendFeedbackMessage {
  type: typeof SEND_FEEDBACK;
  kind: FeedbackKindId;
  description: string;
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
}

export interface SendFeedbackResult {
  ok: boolean;
  error: string | null;
}

export const OPEN_URL = 'ugly-fact:open-url' as const;

export interface OpenUrlMessage {
  type: typeof OPEN_URL;
  url: string;
}

/**
 * Where each actionable state sends the user. Neither is invented:
 *  - login goes to the app itself, where the framework's LoginPopup takes over,
 *    so the extension never constructs an OAuth URL or handles credentials.
 *  - billing is the same external destination ugly-studio's desktop-caps opens.
 */
export const LOGIN_URL = 'https://ugly.press/';
export const BILLING_URL = 'https://ugly.bot/account/billing';
