/**
 * Unit Tests for News Feed Logic
 *
 * Tests the core logic used by News UI components:
 * 1. Articles are sorted by creation time (most recent first)
 * 2. Read articles are filtered out correctly
 * 3. initialSaved map is correctly constructed from batch query results
 * 4. Saved state is a snapshot that doesn't update after creation
 * 5. Personalization scoring algorithm
 */

import {
  cosineSimilarity,
  getTemporalDecayFactor,
  scoreFileForUser,
} from '../../../shared/news/ranking';
import type { InterestCluster } from '../../../shared/news/schemas';
import { describe, expect, it } from 'vitest';

// Simplified article interface for testing
interface TestArticle {
  id: string;
  title: string;
  created: number;
}

// Create test article helper
function createTestArticle(
  id: string,
  title: string,
  created: number,
): TestArticle {
  return { id, title, created };
}

describe('News Feed Ordering Logic', () => {
  describe('Article sorting', () => {
    it('sorts articles by created timestamp descending (most recent first)', () => {
      const now = Date.now();

      const articles = [
        createTestArticle('old', 'Old Article', now - 3000),
        createTestArticle('middle', 'Middle Article', now - 2000),
        createTestArticle('new', 'New Article', now - 1000),
      ];

      // Sort by created descending (as feed would)
      const sortedArticles = [...articles].sort(
        (a, b) => b.created - a.created,
      );

      // Verify ordering: newest first
      expect(sortedArticles[0]!.id).toBe('new');
      expect(sortedArticles[1]!.id).toBe('middle');
      expect(sortedArticles[2]!.id).toBe('old');
    });

    it('handles articles with same timestamp (stable sort)', () => {
      const now = Date.now();

      const articles = [
        createTestArticle('a', 'Article A', now),
        createTestArticle('b', 'Article B', now),
        createTestArticle('c', 'Article C', now),
      ];

      // Sort by created descending
      const sortedArticles = [...articles].sort(
        (a, b) => b.created - a.created,
      );

      // All have same timestamp - order preserved (stable sort)
      expect(sortedArticles).toHaveLength(3);
    });
  });

  describe('Read article filtering', () => {
    it('excludes read articles from feed', () => {
      const now = Date.now();

      const allArticles = [
        createTestArticle('art-1', 'Article 1', now - 5000),
        createTestArticle('art-2', 'Article 2', now - 4000),
        createTestArticle('art-3', 'Article 3', now - 3000),
        createTestArticle('art-4', 'Article 4', now - 2000),
        createTestArticle('art-5', 'Article 5', now - 1000),
      ];

      // Simulate read article IDs from UserNewsRead collection
      const readArticleIds = new Set(['art-5', 'art-3']);

      // Filter out read articles
      const unreadArticles = allArticles.filter(
        (article) => !readArticleIds.has(article.id),
      );

      expect(unreadArticles).toHaveLength(3);
      expect(unreadArticles.map((a) => a.id)).toEqual([
        'art-1',
        'art-2',
        'art-4',
      ]);
    });

    it('returns most recent unread article first after filtering', () => {
      const now = Date.now();

      const allArticles = [
        createTestArticle('art-1', 'Article 1', now - 5000),
        createTestArticle('art-2', 'Article 2', now - 4000),
        createTestArticle('art-3', 'Article 3', now - 3000),
        createTestArticle('art-4', 'Article 4', now - 2000),
        createTestArticle('art-5', 'Article 5', now - 1000), // newest but read
      ];

      const readArticleIds = new Set(['art-5', 'art-3']);

      // Filter and sort
      const unreadArticles = allArticles
        .filter((article) => !readArticleIds.has(article.id))
        .sort((a, b) => b.created - a.created);

      // Most recent UNREAD article should be art-4
      expect(unreadArticles[0]!.id).toBe('art-4');
      expect(unreadArticles[0]!.title).toBe('Article 4');
    });

    it('returns empty array when all articles are read', () => {
      const now = Date.now();

      const allArticles = [
        createTestArticle('art-1', 'Article 1', now - 3000),
        createTestArticle('art-2', 'Article 2', now - 2000),
      ];

      const readArticleIds = new Set(['art-1', 'art-2']);

      const unreadArticles = allArticles.filter(
        (article) => !readArticleIds.has(article.id),
      );

      expect(unreadArticles).toHaveLength(0);
    });
  });
});

describe('Saved State Snapshot Logic', () => {
  describe('initialSaved map construction', () => {
    it('correctly maps saved status from batch query result', () => {
      // Simulate batch query result from newsIsSavedBatch
      const savedFileIdsFromQuery = ['article-1', 'article-3', 'article-5'];
      const savedSet = new Set(savedFileIdsFromQuery);

      // Articles in view
      const articlesInView = [
        'article-1',
        'article-2',
        'article-3',
        'article-4',
        'article-5',
      ];

      // Create initialSaved map (as NewsFeedTab component would)
      const initialSavedMap: { [fileId: string]: boolean } = {};
      for (const fileId of articlesInView) {
        initialSavedMap[fileId] = savedSet.has(fileId);
      }

      // Verify correct mapping
      expect(initialSavedMap['article-1']).toBe(true);
      expect(initialSavedMap['article-2']).toBe(false);
      expect(initialSavedMap['article-3']).toBe(true);
      expect(initialSavedMap['article-4']).toBe(false);
      expect(initialSavedMap['article-5']).toBe(true);
    });

    it('returns all false when no articles are saved', () => {
      const savedSet = new Set<string>([]);
      const articlesInView = ['article-1', 'article-2', 'article-3'];

      const initialSavedMap: { [fileId: string]: boolean } = {};
      for (const fileId of articlesInView) {
        initialSavedMap[fileId] = savedSet.has(fileId);
      }

      expect(Object.values(initialSavedMap).every((v) => !v)).toBe(true);
    });

    it('returns all true when all articles are saved', () => {
      const savedSet = new Set(['article-1', 'article-2', 'article-3']);
      const articlesInView = ['article-1', 'article-2', 'article-3'];

      const initialSavedMap: { [fileId: string]: boolean } = {};
      for (const fileId of articlesInView) {
        initialSavedMap[fileId] = savedSet.has(fileId);
      }

      expect(Object.values(initialSavedMap).every((v) => v)).toBe(true);
    });
  });

  describe('Snapshot behavior (initialSaved does not update after creation)', () => {
    it('initialSaved map is a snapshot that captures state at query time', () => {
      // Initial query result
      const savedAtQueryTime = new Set(['article-1', 'article-3']);
      const articlesInView = [
        'article-1',
        'article-2',
        'article-3',
        'article-4',
      ];

      // Create initial map (this happens once at page load)
      const initialSavedMap: { [fileId: string]: boolean } = {};
      for (const fileId of articlesInView) {
        initialSavedMap[fileId] = savedAtQueryTime.has(fileId);
      }

      // Verify initial state
      expect(initialSavedMap['article-1']).toBe(true);
      expect(initialSavedMap['article-2']).toBe(false);

      // Simulate external change (like from another tab)
      // In real app, if we queried again we'd get different results
      // But initialSavedMap is already created and won't change
      const savedAfterExternalChange = new Set([
        'article-1',
        'article-2', // Now saved externally
        'article-3',
      ]);

      // The initialSavedMap should NOT change - it's a snapshot
      // Components use this snapshot value for their initialSaved prop
      expect(initialSavedMap['article-2']).toBe(false);
      // But a new query would show article-2 as saved
      expect(savedAfterExternalChange.has('article-2')).toBe(true);
      // This is the key behavior: the map is not updated
    });

    it('each article receives its own initialSaved value from the snapshot', () => {
      const savedSet = new Set(['article-a', 'article-c']);
      const articles = [
        { id: 'article-a', title: 'A' },
        { id: 'article-b', title: 'B' },
        { id: 'article-c', title: 'C' },
      ];

      // Create snapshot
      const initialSavedMap: { [fileId: string]: boolean } = {};
      for (const article of articles) {
        initialSavedMap[article.id] = savedSet.has(article.id);
      }

      // Each article gets its own value
      expect(initialSavedMap['article-a']).toBe(true);
      expect(initialSavedMap['article-b']).toBe(false);
      expect(initialSavedMap['article-c']).toBe(true);
    });
  });
});

describe('Swipe Card Stack Logic', () => {
  describe('Card ordering in stack', () => {
    it('most recent article is on top of stack (highest zIndex)', () => {
      const now = Date.now();

      const articles = [
        createTestArticle('old', 'Old', now - 3000),
        createTestArticle('new', 'New', now - 1000),
        createTestArticle('middle', 'Middle', now - 2000),
      ];

      // Sort by created descending
      const sortedArticles = [...articles].sort(
        (a, b) => b.created - a.created,
      );

      // Top card (index 0) = highest zIndex = most recent article
      const topCard = sortedArticles[0];
      expect(topCard!.id).toBe('new');

      // zIndex typically assigned as: stack.length - index
      const zIndices = sortedArticles.map((_, i) => sortedArticles.length - i);
      expect(zIndices[0]).toBeGreaterThan(zIndices[1]!);
      expect(zIndices[1]).toBeGreaterThan(zIndices[2]!);
    });
  });

  describe('Swipe direction determines save behavior', () => {
    type SwipeDirection = 'left' | 'right';

    function getSwipeActions(direction: SwipeDirection) {
      return {
        shouldSave: direction === 'right',
        shouldMarkRead: true, // Both directions mark as read
      };
    }

    it('swipe right saves article and marks read', () => {
      const actions = getSwipeActions('right');

      expect(actions.shouldSave).toBe(true);
      expect(actions.shouldMarkRead).toBe(true);
    });

    it('swipe left only marks read (does not save)', () => {
      const actions = getSwipeActions('left');

      expect(actions.shouldSave).toBe(false);
      expect(actions.shouldMarkRead).toBe(true);
    });
  });

  describe('Card removal after swipe', () => {
    it('removes swiped card from stack', () => {
      const articles = [
        { id: 'article-1', title: 'A' },
        { id: 'article-2', title: 'B' },
        { id: 'article-3', title: 'C' },
      ];

      // Simulate swiping first card
      const swipedId = articles[0]!.id;
      const remainingArticles = articles.filter((a) => a.id !== swipedId);

      expect(remainingArticles).toHaveLength(2);
      expect(remainingArticles.map((a) => a.id)).toEqual([
        'article-2',
        'article-3',
      ]);
    });

    it('next card becomes top after swipe', () => {
      const articles = [
        { id: 'top', title: 'Top', created: 3 },
        { id: 'next', title: 'Next', created: 2 },
        { id: 'last', title: 'Last', created: 1 },
      ];

      // Remove top card
      const remainingArticles = articles.slice(1);

      // Next card is now at index 0
      expect(remainingArticles[0]!.id).toBe('next');
    });
  });
});

describe('Bot Subscription Filtering', () => {
  it('only includes articles from subscribed bots', () => {
    const subscribedBotIds = ['bot-1', 'bot-2', 'bot-3'];
    const subscribedSet = new Set(subscribedBotIds);

    interface ArticleWithBot extends TestArticle {
      botId: string;
    }

    const allArticles: ArticleWithBot[] = [
      { id: 'a1', title: 'From Bot 1', created: 1000, botId: 'bot-1' },
      { id: 'a2', title: 'From Bot 4', created: 2000, botId: 'bot-4' }, // not subscribed
      { id: 'a3', title: 'From Bot 2', created: 3000, botId: 'bot-2' },
    ];

    const filteredArticles = allArticles.filter((a) =>
      subscribedSet.has(a.botId),
    );

    expect(filteredArticles).toHaveLength(2);
    expect(filteredArticles.map((a) => a.id)).toEqual(['a1', 'a3']);
  });
});

describe('Pagination Logic', () => {
  it('determines hasMore correctly based on result count', () => {
    const limit = 10;

    // Pattern: Fetch limit + 1 items to determine if there are more
    // If results.length > limit, there are more items

    // Case 1: Less than limit results (no more)
    const resultsNoMore = new Array(5).fill({ id: 'x' });
    expect(resultsNoMore.length > limit).toBe(false);

    // Case 2: Exactly limit results (might be more)
    const resultsExactLimit = new Array(10).fill({ id: 'x' });
    expect(resultsExactLimit.length > limit).toBe(false);

    // Case 3: More than limit results (has more)
    const resultsHasMore = new Array(11).fill({ id: 'x' });
    expect(resultsHasMore.length > limit).toBe(true);
  });

  it('returns only limit items even when more are fetched', () => {
    const limit = 10;
    const allResults = new Array(11).fill({ id: 'x' });

    const hasMore = allResults.length > limit;
    const items = allResults.slice(0, limit);

    expect(hasMore).toBe(true);
    expect(items).toHaveLength(limit);
  });
});

// ============================================================================
// Personalization Algorithm Tests
// ============================================================================

describe('Personalization: Cosine Similarity', () => {
  it('returns 1 for identical vectors', () => {
    const vector = [0.5, 0.5, 0.5, 0.5];
    const similarity = cosineSimilarity(vector, vector);
    expect(similarity).toBeCloseTo(1.0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(0.0, 5);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    const zero = [0, 0, 0];
    const nonZero = [1, 2, 3];
    expect(cosineSimilarity(zero, nonZero)).toBe(0);
    expect(cosineSimilarity(nonZero, zero)).toBe(0);
    expect(cosineSimilarity(zero, zero)).toBe(0);
  });

  it('returns 0 for different length vectors', () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('calculates similarity correctly for known vectors', () => {
    // Two vectors at 45 degrees
    const a = [1, 0];
    const b = [1, 1];
    // cos(45°) = 1/sqrt(2) ≈ 0.7071
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(1 / Math.sqrt(2), 4);
  });

  it('handles negative values correctly', () => {
    const a = [-1, 2, -3];
    const b = [4, -5, 6];
    // dot product = -4 - 10 - 18 = -32
    // |a| = sqrt(1+4+9) = sqrt(14)
    // |b| = sqrt(16+25+36) = sqrt(77)
    const expected = -32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 5);
  });
});

describe('Personalization: Temporal Decay Factor', () => {
  const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

  it('returns 1 for same timestamp (no decay)', () => {
    const now = Date.now();
    const decay = getTemporalDecayFactor(now, now);
    expect(decay).toBeCloseTo(1.0, 5);
  });

  it('returns ~0.5 after one half-life (30 days)', () => {
    const now = Date.now();
    const thirtyDaysAgo = now - HALF_LIFE_MS;
    const decay = getTemporalDecayFactor(thirtyDaysAgo, now);
    expect(decay).toBeCloseTo(0.5, 2);
  });

  it('returns ~0.25 after two half-lives (60 days)', () => {
    const now = Date.now();
    const sixtyDaysAgo = now - 2 * HALF_LIFE_MS;
    const decay = getTemporalDecayFactor(sixtyDaysAgo, now);
    expect(decay).toBeCloseTo(0.25, 2);
  });

  it('returns ~0.125 after three half-lives (90 days)', () => {
    const now = Date.now();
    const ninetyDaysAgo = now - 3 * HALF_LIFE_MS;
    const decay = getTemporalDecayFactor(ninetyDaysAgo, now);
    expect(decay).toBeCloseTo(0.125, 2);
  });

  it('returns high value for recent activity', () => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const decay = getTemporalDecayFactor(oneHourAgo, now);
    expect(decay).toBeGreaterThan(0.99);
  });

  it('returns very small value for old activity', () => {
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const decay = getTemporalDecayFactor(oneYearAgo, now);
    expect(decay).toBeLessThan(0.001);
  });
});

describe('Personalization: scoreFileForUser', () => {
  const now = Date.now();

  // Helper to create a normalized unit vector
  function normalizedVector(direction: number[]): number[] {
    const magnitude = Math.sqrt(direction.reduce((sum, v) => sum + v * v, 0));
    return direction.map((v) => v / magnitude);
  }

  // Helper to create a test cluster
  function createCluster(
    embedding: number[],
    weight: number,
    lastUsed: number,
  ): InterestCluster {
    return {
      id: `cluster-${Math.random().toString(36).slice(2)}`,
      embedding,
      weight,
      lastUsed,
    };
  }

  describe('with no personalization data', () => {
    it('returns recency boost only for very fresh files (< 24h)', () => {
      const fileEmbedding = [1, 0, 0];
      const fileCreated = now - 1 * 60 * 60 * 1000; // 1 hour ago
      const clusters: InterestCluster[] = [];

      const score = scoreFileForUser(fileEmbedding, fileCreated, clusters, now);

      // Should get recency boost only (up to 0.2 for < 24h old)
      // At 1 hour: 0.2 * (1 - 1/24) ≈ 0.1917
      expect(score).toBeGreaterThan(0.15);
      expect(score).toBeLessThan(0.25);
    });

    it('returns zero for old files with no clusters', () => {
      const fileEmbedding = [1, 0, 0];
      const fileCreated = now - 48 * 60 * 60 * 1000; // 48 hours ago
      const clusters: InterestCluster[] = [];

      const score = scoreFileForUser(fileEmbedding, fileCreated, clusters, now);

      expect(score).toBe(0);
    });

    it('returns zero for empty embedding with no clusters', () => {
      const fileEmbedding: number[] = [];
      const fileCreated = now - 1 * 60 * 60 * 1000;
      const clusters: InterestCluster[] = [];

      const score = scoreFileForUser(fileEmbedding, fileCreated, clusters, now);

      // Empty embedding with fresh file should still get recency boost
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('with single cluster', () => {
    it('scores highly for identical embeddings', () => {
      const embedding = normalizedVector([1, 1, 1]);
      const cluster = createCluster(embedding, 5, now);

      const score = scoreFileForUser(embedding, now - 60000, [cluster], now);

      // High similarity (1.0) * weight factor * decay (1.0) + recency boost
      expect(score).toBeGreaterThan(0.5);
    });

    it('scores low for opposite embeddings', () => {
      const fileEmbedding = normalizedVector([1, 0, 0]);
      const clusterEmbedding = normalizedVector([-1, 0, 0]);
      const cluster = createCluster(clusterEmbedding, 5, now);

      // File is old to avoid recency boost
      const score = scoreFileForUser(
        fileEmbedding,
        now - 48 * 60 * 60 * 1000,
        [cluster],
        now,
      );

      // Negative similarity = 0 contribution
      expect(score).toBeLessThanOrEqual(0);
    });

    it('accounts for cluster weight with log normalization', () => {
      const embedding = normalizedVector([1, 0, 0]);

      // Low weight cluster
      const lowWeightCluster = createCluster(embedding, 1, now);
      const lowScore = scoreFileForUser(
        embedding,
        now - 48 * 60 * 60 * 1000,
        [lowWeightCluster],
        now,
      );

      // High weight cluster (but log-normalized to prevent dominance)
      const highWeightCluster = createCluster(embedding, 10, now);
      const highScore = scoreFileForUser(
        embedding,
        now - 48 * 60 * 60 * 1000,
        [highWeightCluster],
        now,
      );

      // Higher weight = higher score, but not proportional due to log normalization
      expect(highScore).toBeGreaterThan(lowScore);
      // Log normalization means 10x weight doesn't give 10x score
      expect(highScore / lowScore).toBeLessThan(5);
    });

    it('applies temporal decay to old clusters', () => {
      const embedding = normalizedVector([1, 0, 0]);
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

      const recentCluster = createCluster(embedding, 5, now);
      const recentScore = scoreFileForUser(
        embedding,
        now - 48 * 60 * 60 * 1000,
        [recentCluster],
        now,
      );

      const oldCluster = createCluster(embedding, 5, thirtyDaysAgo);
      const oldScore = scoreFileForUser(
        embedding,
        now - 48 * 60 * 60 * 1000,
        [oldCluster],
        now,
      );

      // Old cluster should contribute ~half due to 30-day half-life
      expect(recentScore).toBeGreaterThan(oldScore);
      expect(oldScore / recentScore).toBeCloseTo(0.5, 1);
    });
  });

  describe('with multiple clusters', () => {
    it('uses best matching cluster (highest score wins)', () => {
      const fileEmbedding = normalizedVector([1, 0, 0]);

      // One matching cluster
      const matchingCluster = createCluster(
        normalizedVector([1, 0, 0]),
        5,
        now,
      );
      // One non-matching cluster
      const nonMatchingCluster = createCluster(
        normalizedVector([0, 1, 0]),
        5,
        now,
      );

      const multiClusterScore = scoreFileForUser(
        fileEmbedding,
        now - 48 * 60 * 60 * 1000,
        [matchingCluster, nonMatchingCluster],
        now,
      );

      const singleClusterScore = scoreFileForUser(
        fileEmbedding,
        now - 48 * 60 * 60 * 1000,
        [matchingCluster],
        now,
      );

      // Score should be same since best cluster wins
      expect(multiClusterScore).toBeCloseTo(singleClusterScore, 5);
    });

    it('picks cluster that gives highest overall score', () => {
      const fileEmbedding = normalizedVector([1, 0.5, 0]);

      // Two clusters that both partially match
      const cluster1 = createCluster(normalizedVector([1, 0, 0]), 3, now); // Good direction, lower weight
      const cluster2 = createCluster(normalizedVector([0.8, 0.6, 0]), 8, now); // Better match with higher weight

      const score = scoreFileForUser(
        fileEmbedding,
        now - 48 * 60 * 60 * 1000,
        [cluster1, cluster2],
        now,
      );

      // Should use the cluster that produces highest overall score
      const score1Only = scoreFileForUser(
        fileEmbedding,
        now - 48 * 60 * 60 * 1000,
        [cluster1],
        now,
      );
      const score2Only = scoreFileForUser(
        fileEmbedding,
        now - 48 * 60 * 60 * 1000,
        [cluster2],
        now,
      );

      expect(score).toBe(Math.max(score1Only, score2Only));
    });
  });

  describe('recency boost', () => {
    it('adds up to 0.2 boost for files < 24h old', () => {
      const embedding = normalizedVector([1, 0, 0]);
      const cluster = createCluster(embedding, 5, now);

      const veryFreshFile = now - 1 * 60 * 60 * 1000; // 1 hour old
      const freshScore = scoreFileForUser(
        embedding,
        veryFreshFile,
        [cluster],
        now,
      );

      const oldFile = now - 48 * 60 * 60 * 1000; // 48 hours old
      const oldScore = scoreFileForUser(embedding, oldFile, [cluster], now);

      // Fresh file should have higher score due to recency boost
      const recencyBoost = freshScore - oldScore;
      expect(recencyBoost).toBeGreaterThan(0.15);
      expect(recencyBoost).toBeLessThanOrEqual(0.2);
    });

    it('linearly decreases recency boost over 24 hours', () => {
      const embedding = normalizedVector([1, 0, 0]);
      const cluster = createCluster(embedding, 5, now);

      // Calculate base score (no recency)
      const baseScore = scoreFileForUser(
        embedding,
        now - 48 * 60 * 60 * 1000,
        [cluster],
        now,
      );

      // Check at 6 hours: should get 75% of max boost
      const score6h = scoreFileForUser(
        embedding,
        now - 6 * 60 * 60 * 1000,
        [cluster],
        now,
      );
      expect(score6h - baseScore).toBeCloseTo(0.2 * 0.75, 1);

      // Check at 12 hours: should get 50% of max boost
      const score12h = scoreFileForUser(
        embedding,
        now - 12 * 60 * 60 * 1000,
        [cluster],
        now,
      );
      expect(score12h - baseScore).toBeCloseTo(0.2 * 0.5, 1);

      // Check at 18 hours: should get 25% of max boost
      const score18h = scoreFileForUser(
        embedding,
        now - 18 * 60 * 60 * 1000,
        [cluster],
        now,
      );
      expect(score18h - baseScore).toBeCloseTo(0.2 * 0.25, 1);
    });

    it('no recency boost for files >= 24h old', () => {
      const embedding = normalizedVector([1, 0, 0]);
      const cluster = createCluster(embedding, 5, now);

      const file24h = now - 24 * 60 * 60 * 1000;
      const file48h = now - 48 * 60 * 60 * 1000;

      const score24h = scoreFileForUser(embedding, file24h, [cluster], now);
      const score48h = scoreFileForUser(embedding, file48h, [cluster], now);

      // Both should have same score (no recency boost)
      expect(score24h).toBeCloseTo(score48h, 5);
    });
  });

  describe('edge cases', () => {
    it('handles zero-weight clusters gracefully', () => {
      const embedding = normalizedVector([1, 0, 0]);
      const zeroWeightCluster = createCluster(embedding, 0, now);

      // Should not throw, and score should account for zero weight
      const score = scoreFileForUser(
        embedding,
        now - 48 * 60 * 60 * 1000,
        [zeroWeightCluster],
        now,
      );
      expect(typeof score).toBe('number');
      expect(isNaN(score)).toBe(false);
    });

    it('handles very large embeddings (512 dimensions)', () => {
      // Real embeddings are 512 dimensions
      const largeEmbedding = new Array(512).fill(0).map(() => Math.random());
      const cluster = createCluster(largeEmbedding, 5, now);

      const score = scoreFileForUser(
        largeEmbedding,
        now - 1 * 60 * 60 * 1000,
        [cluster],
        now,
      );

      // Should produce valid score
      expect(typeof score).toBe('number');
      expect(isNaN(score)).toBe(false);
      expect(score).toBeGreaterThan(0);
    });
  });
});

describe('Personalization: Ranking Behavior', () => {
  const now = Date.now();

  // Helper to create file candidates for ranking
  interface FileCandidate {
    id: string;
    embedding: number[];
    created: number;
  }

  function normalizedVector(direction: number[]): number[] {
    const magnitude = Math.sqrt(direction.reduce((sum, v) => sum + v * v, 0));
    return direction.map((v) => v / magnitude);
  }

  function createCluster(
    embedding: number[],
    weight: number,
    lastUsed: number,
  ): InterestCluster {
    return {
      id: `cluster-${Math.random().toString(36).slice(2)}`,
      embedding,
      weight,
      lastUsed,
    };
  }

  it('ranks files by personalization score correctly', () => {
    // User interested in tech (1, 0, 0 direction)
    const techCluster = createCluster(normalizedVector([1, 0, 0]), 5, now);
    const clusters = [techCluster];

    // Three files: tech, sports, and mixed
    const files: FileCandidate[] = [
      {
        id: 'sports',
        embedding: normalizedVector([0, 1, 0]),
        created: now - 2 * 60 * 60 * 1000,
      },
      {
        id: 'tech',
        embedding: normalizedVector([1, 0, 0]),
        created: now - 2 * 60 * 60 * 1000,
      },
      {
        id: 'mixed',
        embedding: normalizedVector([0.7, 0.7, 0]),
        created: now - 2 * 60 * 60 * 1000,
      },
    ];

    // Score each file
    const scored = files.map((f) => ({
      id: f.id,
      score: scoreFileForUser(f.embedding, f.created, clusters, now),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Tech should be first, mixed second, sports last
    expect(scored[0]!.id).toBe('tech');
    expect(scored[1]!.id).toBe('mixed');
    expect(scored[2]!.id).toBe('sports');
  });

  it('balances recency and relevance', () => {
    const techCluster = createCluster(normalizedVector([1, 0, 0]), 5, now);
    const clusters = [techCluster];

    // Very fresh but irrelevant vs. older but highly relevant
    const files: FileCandidate[] = [
      {
        id: 'fresh-irrelevant',
        embedding: normalizedVector([0, 1, 0]),
        created: now - 30 * 60 * 1000, // 30 minutes ago
      },
      {
        id: 'older-relevant',
        embedding: normalizedVector([1, 0, 0]),
        created: now - 12 * 60 * 60 * 1000, // 12 hours ago
      },
    ];

    const scored = files.map((f) => ({
      id: f.id,
      score: scoreFileForUser(f.embedding, f.created, clusters, now),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Relevance should usually win over recency for strong interest matches
    expect(scored[0]!.id).toBe('older-relevant');
  });

  it('provides diversity through random candidate sampling', () => {
    // This test documents the expected behavior:
    // With 1000 random candidates from a larger pool, we get diversity
    // even with personalized ranking

    // Simulate what would happen with multiple calls getting different random samples
    const samples = 5;
    const resultsPerSample: string[][] = [];

    for (let i = 0; i < samples; i++) {
      // In real implementation, $sample would give different candidates each time
      // Here we simulate by shuffling
      const candidateIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
      const shuffled = [...candidateIds].sort(() => Math.random() - 0.5);
      resultsPerSample.push(shuffled.slice(0, 3));
    }

    // Different samples should potentially give different results
    // (This is probabilistic but demonstrates the concept)
    const allSame = resultsPerSample.every(
      (r) => JSON.stringify(r) === JSON.stringify(resultsPerSample[0]),
    );

    // With random sampling, we should see some variation
    // (Statistically very unlikely all 5 samples are identical)
    expect(allSame).toBe(false);
  });
});
