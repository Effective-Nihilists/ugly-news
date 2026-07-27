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
