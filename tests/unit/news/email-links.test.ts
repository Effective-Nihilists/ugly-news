import { describe, expect, it } from 'vitest';
import { renderDailyNewsEmail, type NewsEmailArticle } from '../../../server/news/email';

// Every shareable link in the daily email must be a central short link
// (https://ugly.bot/l/<code>) so it deep-links into the app + renders an OG card.
// fileToEmailArticle / dispatchUserPrivateNewsEmail mint these via shareLink();
// this test verifies the template itself never emits a bare app URL.
const SHORT = 'https://ugly.bot/l/';

function article(id: string): NewsEmailArticle {
  return {
    fileId: id,
    title: `Title ${id}`,
    summary: 'summary',
    thumbnailUri: null,
    uri: `${SHORT}${id}code`,
    engagementCount: 0,
  };
}

function extractHrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
}

describe('renderDailyNewsEmail links', () => {
  const articles = {
    hero: article('a1'),
    trending: [article('t1'), article('t2')],
    pickedForYou: [article('p1')],
    categorySpotlight: [article('c1')],
    totalUnread: 5,
    topCategory: 'World',
  };

  it('emits only central short links (no bare app URLs → no client 404)', () => {
    const html = renderDailyNewsEmail(
      {
        greeting: 'g',
        trendingTitle: 't',
        trendingSubtitle: 'ts',
        pickedTitle: 'p',
        pickedSubtitle: 'ps',
        categoryPrefix: 'Today in %s',
        seeAll: 'See all %d',
        buttonText: 'Open Ugly News',
      },
      'June 28, 2026',
      articles,
      { title: 'Pod', duration: '5 min', uri: `${SHORT}podcode` },
      `${SHORT}homecode`,
    );

    const hrefs = extractHrefs(html);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith(SHORT), `non-short link in email: ${href}`).toBe(true);
    }
  });
});
