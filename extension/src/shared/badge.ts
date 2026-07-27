import type { PageReport } from './messages';

export const BADGE_ENGAGED = '#e8590c';
export const BADGE_DORMANT = '#9b917f';

export interface BadgeState {
  text: string;
  color: string;
  title: string;
}

/**
 * Dormant must be visible, never silent — a user who thinks the feature is
 * broken has been failed more thoroughly than one who disagrees with it.
 */
export function badgeFor(report: PageReport): BadgeState {
  if (!report.verdict.engage) {
    return {
      text: '',
      color: BADGE_DORMANT,
      title: `Dormant — ${report.verdict.reason}`,
    };
  }
  const r = report.rating;
  if (r === null) {
    return {
      text: '?',
      color: BADGE_ENGAGED,
      title: `Unrated publisher — ${report.host}`,
    };
  }
  const sign = r.biasScore >= 0 ? '+' : '';
  return {
    text: '',
    color: BADGE_ENGAGED,
    title: `${r.name} — ${r.bias} ${sign}${String(r.biasScore)}, ${r.factuality} factuality`,
  };
}
