import { describe, expect, it } from 'vitest';
import {
  buildFeedbackReport,
  FEEDBACK_KINDS,
  MAX_SHIPPED_LOGS,
} from '../../../extension/src/shared/feedback';
import type { PageReport } from '../../../extension/src/shared/messages';

const REPORT: PageReport = {
  verdict: { engage: true, stop: null, reason: 'Article with a byline' },
  rating: {
    name: 'Example Times',
    bias: 'center',
    biasScore: 0,
    factuality: 'high',
    owner: 'Example Corp',
    country: 'USA',
  },
  host: 'example.com',
};

function base() {
  return {
    kind: 'missed-claims' as const,
    description: '',
    url: 'https://example.com/story',
    title: 'A story',
    report: REPORT,
    outcome: { returned: 9, painted: 0, error: null },
    logs: [{ timestamp: 1, level: 'log' as const, message: 'hi' }],
    userAgent: 'UA/1.0',
    screenWidth: 1440,
    screenHeight: 900,
    version: '0.1.46',
  };
}

describe('FEEDBACK_KINDS', () => {
  it('covers the two cases the checker actually gets wrong', () => {
    const ids = FEEDBACK_KINDS.map((k) => k.id);
    expect(ids).toContain('should-be-news');
    expect(ids).toContain('missed-claims');
  });

  it('gives every kind a human label for the popup', () => {
    for (const k of FEEDBACK_KINDS) expect(k.label.length).toBeGreaterThan(0);
  });
});

describe('buildFeedbackReport', () => {
  it('maps onto the framework feedback type', () => {
    // The framework enum is bug/feature/design — our kinds are all defects,
    // and the specific kind rides in the description prefix and the context.
    expect(buildFeedbackReport(base()).type).toBe('bug');
  });

  it('prefixes the description with the kind so reports are greppable', () => {
    const r = buildFeedbackReport({ ...base(), description: 'nothing showed' });
    expect(r.description).toBe('[fact-checker/missed-claims] nothing showed');
  });

  it('falls back to the kind label when the user writes nothing', () => {
    // description is required by the framework schema; an empty box must not
    // produce a 400 that silently loses the report.
    const r = buildFeedbackReport(base());
    expect(r.description.length).toBeGreaterThan(
      '[fact-checker/missed-claims]'.length,
    );
  });

  it('carries the page data needed to reproduce the decision', () => {
    const ctx = buildFeedbackReport(base()).context;
    expect(ctx['kind']).toBe('missed-claims');
    expect(ctx['host']).toBe('example.com');
    expect(ctx['verdict']).toEqual(REPORT.verdict);
    expect(ctx['outcome']).toEqual({ returned: 9, painted: 0, error: null });
  });

  it('records the publisher rating, since the gate depends on it', () => {
    const ctx = buildFeedbackReport(base()).context;
    expect(ctx['rating']).toMatchObject({ name: 'Example Times' });
  });

  it('sends the console history along', () => {
    expect(buildFeedbackReport(base()).logs).toHaveLength(1);
  });

  it('ships only the tail of a long console history', () => {
    const logs = Array.from({ length: MAX_SHIPPED_LOGS + 40 }, (_, i) => ({
      timestamp: i,
      level: 'log' as const,
      message: String(i),
    }));
    const out = buildFeedbackReport({ ...base(), logs });
    expect(out.logs).toHaveLength(MAX_SHIPPED_LOGS);
    expect(out.logs.at(-1)?.message).toBe(String(MAX_SHIPPED_LOGS + 39));
  });

  it('marks the surface so extension reports are separable from web ones', () => {
    expect(buildFeedbackReport(base()).page).toContain('extension');
  });

  it('truncates an over-long description to the framework limit', () => {
    const r = buildFeedbackReport({ ...base(), description: 'x'.repeat(9000) });
    expect(r.description.length).toBeLessThanOrEqual(5000);
  });

  it('tolerates a missing report and outcome', () => {
    // The popup can be opened before the content script has reported, and a
    // report from that state is still worth having.
    const r = buildFeedbackReport({
      ...base(),
      report: null,
      outcome: null,
    });
    expect(r.context['verdict']).toBeNull();
    expect(r.context['outcome']).toBeNull();
  });
});
