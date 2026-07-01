import type { Bias, Factuality } from './schemas';

// ============================================================================
// Source bias / factuality / ownership seed.
//
// Curated for the outlets WE ingest (shared/news/types.ts) — not a redistribution
// of any third-party database. `bias` + `biasScore` are our reading of the public
// AllSides / Ad Fontes / Media Bias-Fact Check charts; `factuality` blends their
// reliability ratings; `owner` is from Wikidata/company filings.
//
// `biasScore` is the −6 (far left) .. +6 (far right) position used to derive the
// three-way coverage bucket (see toBiasBucket in server/news/cluster-logic).
//
// Feeds with no entry here (e.g. the Google News aggregators) are treated as
// UNRATED: they still cluster and display, but don't move the bias bar.
// ============================================================================

export interface NewsSourceSeed {
  id: string;
  name: string;
  homepage: string | null;
  domains: string[];
  feedIds: string[];
  bias: Bias;
  biasScore: number;
  factuality: Factuality;
  owner: string | null;
  country: string | null;
}

export const newsSourceSeeds: NewsSourceSeed[] = [
  // ─── Center / center-ish ──────────────────────────────────────────────────
  { id: 'thehill', name: 'The Hill', homepage: 'https://thehill.com', domains: ['thehill.com'], feedIds: ['thehill'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'Nexstar Media Group', country: 'US' },
  { id: 'bbc', name: 'BBC News', homepage: 'https://www.bbc.com/news', domains: ['bbc.com', 'bbc.co.uk'], feedIds: ['bbc_world'], bias: 'center', biasScore: -0.5, factuality: 'high', owner: 'BBC (UK public)', country: 'UK' },
  { id: 'dw', name: 'Deutsche Welle', homepage: 'https://www.dw.com', domains: ['dw.com'], feedIds: ['dw_world'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'ARD (German public)', country: 'DE' },
  { id: 'cnbc', name: 'CNBC', homepage: 'https://www.cnbc.com', domains: ['cnbc.com'], feedIds: ['cnbc'], bias: 'center', biasScore: 0.5, factuality: 'high', owner: 'NBCUniversal (Comcast)', country: 'US' },
  { id: 'marketwatch', name: 'MarketWatch', homepage: 'https://www.marketwatch.com', domains: ['marketwatch.com'], feedIds: ['marketwatch'], bias: 'center', biasScore: 0.5, factuality: 'high', owner: 'Dow Jones (News Corp)', country: 'US' },
  { id: 'fortune', name: 'Fortune', homepage: 'https://fortune.com', domains: ['fortune.com'], feedIds: ['fortune'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'Fortune Media', country: 'US' },
  { id: 'forbes', name: 'Forbes', homepage: 'https://www.forbes.com', domains: ['forbes.com'], feedIds: ['forbes_business'], bias: 'center', biasScore: 1, factuality: 'mixed', owner: 'Forbes Media', country: 'US' },
  { id: 'techcrunch', name: 'TechCrunch', homepage: 'https://techcrunch.com', domains: ['techcrunch.com'], feedIds: ['techcrunch'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'Yahoo (Apollo)', country: 'US' },
  { id: 'theverge', name: 'The Verge', homepage: 'https://www.theverge.com', domains: ['theverge.com'], feedIds: ['theverge'], bias: 'lean-left', biasScore: -1, factuality: 'high', owner: 'Vox Media', country: 'US' },
  { id: 'arstechnica', name: 'Ars Technica', homepage: 'https://arstechnica.com', domains: ['arstechnica.com'], feedIds: ['arstechnica', 'arstechnica_science'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'Condé Nast', country: 'US' },
  { id: 'engadget', name: 'Engadget', homepage: 'https://www.engadget.com', domains: ['engadget.com'], feedIds: ['engadget'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'Yahoo (Apollo)', country: 'US' },
  { id: 'sciencedaily', name: 'ScienceDaily', homepage: 'https://www.sciencedaily.com', domains: ['sciencedaily.com'], feedIds: ['sciencedaily'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'ScienceDaily LLC', country: 'US' },
  { id: 'physorg', name: 'Phys.org', homepage: 'https://phys.org', domains: ['phys.org'], feedIds: ['physorg'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'Science X', country: 'US' },
  { id: 'variety', name: 'Variety', homepage: 'https://variety.com', domains: ['variety.com'], feedIds: ['variety'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'Penske Media', country: 'US' },
  { id: 'hollywoodreporter', name: 'The Hollywood Reporter', homepage: 'https://www.hollywoodreporter.com', domains: ['hollywoodreporter.com'], feedIds: ['hollywoodreporter'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'Penske Media', country: 'US' },
  { id: 'pitchfork', name: 'Pitchfork', homepage: 'https://pitchfork.com', domains: ['pitchfork.com'], feedIds: ['pitchfork'], bias: 'lean-left', biasScore: -1, factuality: 'high', owner: 'Condé Nast', country: 'US' },
  { id: 'espn', name: 'ESPN', homepage: 'https://www.espn.com', domains: ['espn.com'], feedIds: ['espn'], bias: 'center', biasScore: 0, factuality: 'high', owner: 'The Walt Disney Company', country: 'US' },

  // ─── Left ─────────────────────────────────────────────────────────────────
  { id: 'npr', name: 'NPR', homepage: 'https://www.npr.org', domains: ['npr.org'], feedIds: ['npr_politics'], bias: 'lean-left', biasScore: -1.5, factuality: 'high', owner: 'NPR (US public)', country: 'US' },
  { id: 'nbcnews', name: 'NBC News', homepage: 'https://www.nbcnews.com', domains: ['nbcnews.com'], feedIds: ['nbcnews'], bias: 'lean-left', biasScore: -1.5, factuality: 'high', owner: 'NBCUniversal (Comcast)', country: 'US' },
  { id: 'nyt', name: 'The New York Times', homepage: 'https://www.nytimes.com', domains: ['nytimes.com'], feedIds: ['nyt_world'], bias: 'lean-left', biasScore: -1.5, factuality: 'high', owner: 'The New York Times Company', country: 'US' },
  { id: 'aljazeera', name: 'Al Jazeera', homepage: 'https://www.aljazeera.com', domains: ['aljazeera.com'], feedIds: ['aljazeera'], bias: 'lean-left', biasScore: -1.5, factuality: 'mixed', owner: 'Al Jazeera Media Network (Qatar)', country: 'QA' },
  { id: 'wired', name: 'Wired', homepage: 'https://www.wired.com', domains: ['wired.com'], feedIds: ['wired'], bias: 'lean-left', biasScore: -1.5, factuality: 'high', owner: 'Condé Nast', country: 'US' },
  { id: 'scientificamerican', name: 'Scientific American', homepage: 'https://www.scientificamerican.com', domains: ['scientificamerican.com'], feedIds: ['scientificamerican'], bias: 'lean-left', biasScore: -1.5, factuality: 'high', owner: 'Springer Nature', country: 'US' },
  { id: 'guardian', name: 'The Guardian', homepage: 'https://www.theguardian.com', domains: ['theguardian.com'], feedIds: ['guardian_us', 'guardian_world'], bias: 'left', biasScore: -2.5, factuality: 'high', owner: 'Guardian Media Group', country: 'UK' },
  { id: 'rollingstone', name: 'Rolling Stone', homepage: 'https://www.rollingstone.com', domains: ['rollingstone.com'], feedIds: ['rollingstone'], bias: 'left', biasScore: -2.5, factuality: 'mixed', owner: 'Penske Media', country: 'US' },
  { id: 'vox', name: 'Vox', homepage: 'https://www.vox.com', domains: ['vox.com'], feedIds: ['vox'], bias: 'left', biasScore: -3, factuality: 'high', owner: 'Vox Media', country: 'US' },
  { id: 'huffpost', name: 'HuffPost', homepage: 'https://www.huffpost.com', domains: ['huffpost.com'], feedIds: ['huffpost_politics'], bias: 'left', biasScore: -3, factuality: 'mixed', owner: 'BuzzFeed Inc.', country: 'US' },
  { id: 'thenation', name: 'The Nation', homepage: 'https://www.thenation.com', domains: ['thenation.com'], feedIds: ['thenation'], bias: 'left', biasScore: -3.5, factuality: 'mixed', owner: 'The Nation Company', country: 'US' },

  // ─── Right ────────────────────────────────────────────────────────────────
  { id: 'nationalreview', name: 'National Review', homepage: 'https://www.nationalreview.com', domains: ['nationalreview.com'], feedIds: ['nationalreview'], bias: 'right', biasScore: 3, factuality: 'high', owner: 'National Review Institute', country: 'US' },
  { id: 'washingtonexaminer', name: 'Washington Examiner', homepage: 'https://www.washingtonexaminer.com', domains: ['washingtonexaminer.com'], feedIds: ['washingtonexaminer'], bias: 'right', biasScore: 3, factuality: 'mixed', owner: 'Clarity Media Group', country: 'US' },
  { id: 'nypost', name: 'New York Post', homepage: 'https://nypost.com', domains: ['nypost.com'], feedIds: ['nypost'], bias: 'right', biasScore: 3, factuality: 'mixed', owner: 'News Corp', country: 'US' },
  { id: 'foxnews', name: 'Fox News', homepage: 'https://www.foxnews.com', domains: ['foxnews.com'], feedIds: ['foxnews_politics'], bias: 'right', biasScore: 3.5, factuality: 'mixed', owner: 'Fox Corporation', country: 'US' },
  { id: 'dailywire', name: 'The Daily Wire', homepage: 'https://www.dailywire.com', domains: ['dailywire.com'], feedIds: ['dailywire'], bias: 'far-right', biasScore: 4.5, factuality: 'mixed', owner: 'The Daily Wire', country: 'US' },
];

/** feedId → sourceId lookup, derived from the seed's `feedIds`. */
export const feedIdToSourceId: Record<string, string> = Object.fromEntries(
  newsSourceSeeds.flatMap((s) => s.feedIds.map((fid) => [fid, s.id] as const)),
);

/** sourceId → seed lookup. */
export const sourceById: Record<string, NewsSourceSeed> = Object.fromEntries(
  newsSourceSeeds.map((s) => [s.id, s] as const),
);
