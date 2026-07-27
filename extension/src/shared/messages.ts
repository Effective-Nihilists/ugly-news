import type { ClaimClass } from '../../../shared/news/fact-claims';
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

export const SET_STATUS = 'ugly-fact:set-status' as const;

export interface SetStatusMessage {
  type: typeof SET_STATUS;
  status: FactStatus;
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
