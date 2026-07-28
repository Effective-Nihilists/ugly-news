import { describe, expect, it } from 'vitest';
import { claimSummary } from '../../../extension/src/shared/tiers';

// The popup previously rendered "Checked" whenever the gate engaged, regardless
// of what actually happened. A 400 from an undeployed endpoint therefore looked
// identical to a clean run that found nothing — which is how an unregistered
// route went unnoticed. Every distinguishable outcome gets a distinguishable
// row.
describe('claimSummary', () => {
  it('reports skipped when the gate never engaged', () => {
    expect(claimSummary(false, null)).toEqual({
      cls: 'skip',
      value: 'Skipped',
    });
  });

  it('reports running while the call is still in flight', () => {
    expect(claimSummary(true, null).value).toBe('Running');
  });

  it('surfaces a transport error verbatim rather than hiding it', () => {
    const row = claimSummary(true, {
      returned: 0,
      painted: 0,
      error: 'HTTP 400',
    });
    expect(row.cls).toBe('stop');
    expect(row.value).toContain('HTTP 400');
  });

  it('distinguishes a clean empty result from a failure', () => {
    const row = claimSummary(true, { returned: 0, painted: 0, error: null });
    expect(row.cls).toBe('skip');
    expect(row.value).toBe('No claims');
  });

  it('flags total anchoring failure as a stop, not a pass', () => {
    // The model returned claims and NONE of them landed. That is an anchoring
    // bug, and it must not read the same as "the article had no claims".
    const row = claimSummary(true, { returned: 9, painted: 0, error: null });
    expect(row.cls).toBe('stop');
    expect(row.value).toBe('0 of 9 anchored');
  });

  it('shows the shortfall when only some claims anchored', () => {
    const row = claimSummary(true, { returned: 9, painted: 4, error: null });
    expect(row.cls).toBe('pass');
    expect(row.value).toBe('4 of 9');
  });

  it('shows a plain count when everything anchored', () => {
    const row = claimSummary(true, { returned: 6, painted: 6, error: null });
    expect(row).toEqual({ cls: 'pass', value: '6 claims' });
  });

  it('uses the singular for exactly one claim', () => {
    expect(
      claimSummary(true, { returned: 1, painted: 1, error: null }).value,
    ).toBe('1 claim');
  });
});
