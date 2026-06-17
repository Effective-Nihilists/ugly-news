import React from 'react';
import { useRouter } from '../router';
import { navClick } from '../nav';
import { PlayIcon } from '../components/Icon';

/**
 * The Archive (`archive` route) — browse every past story and podcast, with a
 * keyword search and history grouped under date headers. Self-contained
 * newspaper styling (matches HomePage); honors the device safe area because it
 * renders its own full-height scroll container (index.html sets
 * viewport-fit=cover — see CLAUDE.md "Mobile & safe area").
 */

const C = {
  paper: '#f1ece0',
  ink: '#1a1714',
  muted: '#6f665a',
  accent: '#d6261d',
};

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Anton&family=Spectral:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap');`;

const STYLE = `
${FONT_IMPORT}
.ar-link { color: ${C.ink}; text-decoration: none; }
.ar-card { transition: padding-left 0.16s ease; }
.ar-card:hover { padding-left: 6px; }
.ar-card:hover .ar-title { color: ${C.accent}; }
.ar-title { transition: color 0.16s ease; }
.ar-img { transition: transform 0.4s cubic-bezier(0.2,0.7,0.2,1), filter 0.3s ease; filter: grayscale(0.25) contrast(1.05); }
.ar-card:hover .ar-img { transform: scale(1.04); filter: grayscale(0) contrast(1); }
.ar-tab { font-family: 'IBM Plex Mono', monospace; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-size: 12.5px; padding: 11px 20px; cursor: pointer; border: 2px solid ${C.ink}; background: transparent; color: ${C.ink}; transition: background 0.18s ease, color 0.18s ease; }
.ar-tab.active { background: ${C.ink}; color: ${C.paper}; }
.ar-tab:not(.active):hover { background: rgba(26,23,20,0.07); }
.ar-more { font-family: 'IBM Plex Mono', monospace; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-size: 12.5px; background: ${C.ink}; color: ${C.paper}; border: none; padding: 15px 30px; cursor: pointer; transition: background 0.2s ease, transform 0.15s ease; }
.ar-more:hover { background: ${C.accent}; transform: translate(-2px,-2px); box-shadow: 4px 4px 0 ${C.ink}; }
.ar-search { font-family: 'Spectral', serif; font-size: 18px; width: 100%; box-sizing: border-box; padding: 14px 16px; border: 2px solid ${C.ink}; background: #fffdf7; color: ${C.ink}; outline: none; }
.ar-search:focus { box-shadow: 4px 4px 0 ${C.accent}; }
`;

interface StoryCard {
  id: string;
  title: string;
  summary: string;
  thumbnailUri: string | null;
  category: string | null;
  feedId: string | null;
  createdMs: number;
}
interface PodcastCard {
  id: string;
  date: string;
  title: string;
  description: string;
  durationMs: number;
  articleCount: number;
  coverImageUri: string | null;
}

async function rpc<T>(name: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  return ((await res.json()) as { result: T }).result;
}

const PAGE = 30;

/** "Today" / "Yesterday" / "MONDAY, JUNE 9, 2026" from epoch ms. */
function dateLabel(ms: number): string {
  const day = (x: Date) => x.toISOString().slice(0, 10);
  const d = new Date(ms);
  const now = new Date();
  const y = new Date(now);
  y.setUTCDate(now.getUTCDate() - 1);
  if (day(d) === day(now)) return 'Today';
  if (day(d) === day(y)) return 'Yesterday';
  return d
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    .toUpperCase();
}

function groupByDate<T>(items: T[], ms: (t: T) => number): { label: string; rows: T[] }[] {
  const groups: { label: string; rows: T[] }[] = [];
  for (const it of items) {
    const label = dateLabel(ms(it));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(it);
    else groups.push({ label, rows: [it] });
  }
  return groups;
}

function DateHeader({ label }: { label: string }): React.ReactElement {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        background: C.paper,
        zIndex: 2,
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 12,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: C.accent,
        borderBottom: `1px solid ${C.ink}`,
        padding: '14px 0 8px',
        margin: '8px 0 14px',
      }}
    >
      {label}
    </div>
  );
}

function fmtMin(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60000))} min`;
}

export default function ArchivePage(): React.ReactElement {
  const router = useRouter();
  const params = new URLSearchParams(window.location.search);
  const [tab, setTab] = React.useState<'stories' | 'podcasts'>(
    params.get('tab') === 'podcasts' ? 'podcasts' : 'stories',
  );
  const [query, setQuery] = React.useState(params.get('q') ?? '');
  const [debounced, setDebounced] = React.useState(query);

  const [stories, setStories] = React.useState<StoryCard[]>([]);
  const [storyMore, setStoryMore] = React.useState(false);
  const [pods, setPods] = React.useState<PodcastCard[]>([]);
  const [podMore, setPodMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Switching tabs / queries swaps the whole result set — jump back to the top
  // so the new content reads from its start instead of mid-scroll.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab, debounced]);

  // Reflect tab + query into the URL (shareable / back-button friendly).
  React.useEffect(() => {
    const u = new URL(window.location.href);
    if (debounced) u.searchParams.set('q', debounced);
    else u.searchParams.delete('q');
    u.searchParams.set('tab', tab);
    window.history.replaceState(null, '', u.toString());
  }, [tab, debounced]);

  // Debounce the search box.
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  // (Re)load page 0 whenever the tab or search term changes.
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    if (tab === 'stories') {
      rpc<{ items: StoryCard[]; hasMore: boolean }>('newsArchive', { limit: PAGE, skip: 0, query: debounced || undefined })
        .then((r) => { if (alive) { setStories(r.items); setStoryMore(r.hasMore); } })
        .catch(() => { if (alive) { setStories([]); setStoryMore(false); } })
        .finally(() => { if (alive) setLoading(false); });
    } else {
      rpc<{ items: PodcastCard[]; hasMore: boolean }>('newsPodcastArchive', { limit: PAGE, skip: 0 })
        .then((r) => { if (alive) { setPods(r.items); setPodMore(r.hasMore); } })
        .catch(() => { if (alive) { setPods([]); setPodMore(false); } })
        .finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; };
  }, [tab, debounced]);

  async function loadMore(): Promise<void> {
    if (tab === 'stories') {
      const r = await rpc<{ items: StoryCard[]; hasMore: boolean }>('newsArchive', {
        limit: PAGE, skip: stories.length, query: debounced || undefined,
      });
      setStories((s) => [...s, ...r.items]);
      setStoryMore(r.hasMore);
    } else {
      const r = await rpc<{ items: PodcastCard[]; hasMore: boolean }>('newsPodcastArchive', {
        limit: PAGE, skip: pods.length,
      });
      setPods((p) => [...p, ...r.items]);
      setPodMore(r.hasMore);
    }
  }

  // In search mode the rows come back relevance-ranked, so a flat list reads
  // better than date groups (which would repeat headers). Browse mode groups.
  const searchActive = tab === 'stories' && !!debounced;
  const storyGroups = groupByDate(stories, (s) => s.createdMs);
  const podGroups = groupByDate(pods, (p) => Date.parse(`${p.date}T00:00:00Z`));
  const hasMore = tab === 'stories' ? storyMore : podMore;
  const currentCount = tab === 'stories' ? stories.length : pods.length;
  // Keep results MOUNTED while a new query loads (just dim them) — unmounting on
  // every keystroke collapsed the list to 0px and back, a jarring jump. Only the
  // very first load (nothing to show yet) gets the full-screen loading line.
  const initialLoading = loading && currentCount === 0;
  const empty = !loading && currentCount === 0;

  const mono = (size: number, color = C.muted): React.CSSProperties => ({
    fontFamily: 'IBM Plex Mono, monospace', fontSize: size, letterSpacing: '0.08em', textTransform: 'uppercase', color,
  });

  const renderStory = (a: StoryCard): React.ReactElement => (
    <a
      key={a.id}
      href={`/article/${a.id}`}
      onClick={navClick(() => router.push('article/:id', { id: a.id }))}
      className="ar-card ar-link"
      style={{
        display: 'grid',
        gridTemplateColumns: a.thumbnailUri ? '1fr 120px' : '1fr',
        gap: 18,
        padding: '16px 0',
        borderBottom: `1px solid rgba(26,23,20,0.16)`,
        alignItems: 'start',
      }}
    >
      <div>
        {a.category && <div style={{ ...mono(10.5, C.accent), letterSpacing: '0.16em', marginBottom: 5 }}>{a.category}</div>}
        <h3 className="ar-title" style={{ fontFamily: 'Spectral, serif', fontWeight: 600, fontSize: 21, lineHeight: 1.18, margin: '0 0 6px' }}>{a.title}</h3>
        <p style={{ fontFamily: 'Spectral, serif', fontSize: 15.5, lineHeight: 1.5, color: '#3a342c', margin: '0 0 6px' }}>{a.summary}</p>
        <div style={mono(10.5)}>
          {new Date(a.createdMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}
          {a.feedId ? ` · ${a.feedId}` : ''} · Read →
        </div>
      </div>
      {a.thumbnailUri && (
        <div style={{ overflow: 'hidden', border: `1px solid rgba(26,23,20,0.18)`, alignSelf: 'stretch', minHeight: 84 }}>
          <img src={a.thumbnailUri} alt="" className="ar-img" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', aspectRatio: '4/3' }} />
        </div>
      )}
    </a>
  );

  return (
    <div
      ref={scrollRef}
      style={{
        height: '100%',
        overflowY: 'scroll',
        // Always reserve the scrollbar gutter so the content width (and the
        // 100%-wide search input) doesn't jump when results shrink/grow and the
        // scrollbar appears/disappears. `scrollbar-gutter` covers modern
        // browsers; `overflow-y: scroll` is the universal fallback.
        scrollbarGutter: 'stable',
        background: C.paper,
        color: C.ink,
        // Honor the device safe area (viewport-fit=cover is set in index.html).
        boxSizing: 'border-box',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        backgroundImage: 'radial-gradient(rgba(26,23,20,0.05) 1px, transparent 1px)',
        backgroundSize: '3px 3px',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />

      <div style={{ maxWidth: 1040, margin: '0 auto', padding: 'clamp(18px,4vw,40px) clamp(18px,5vw,56px) 80px' }}>
        {/* Masthead */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <a href="/" onClick={navClick(() => router.push('', {}))} className="ar-link" style={mono(12, C.ink)}>← The Ugly Press</a>
          <span style={mono(11)}>The Archive</span>
        </div>
        <div style={{ height: 6, background: C.ink, marginBottom: 6 }} />
        <h1
          style={{
            fontFamily: 'Anton, sans-serif', fontWeight: 400, fontSize: 'clamp(40px,9vw,96px)',
            lineHeight: 0.86, textTransform: 'uppercase', margin: '6px 0 4px', textAlign: 'center',
          }}
        >
          The Archive
        </h1>
        <div style={{ height: 3, background: C.ink }} />
        <p style={{ ...mono(11), textAlign: 'center', padding: '8px 0 22px' }}>
          Every story & every episode — by the day
        </p>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 18 }}>
          <button className={`ar-tab ${tab === 'stories' ? 'active' : ''}`} onClick={() => setTab('stories')}>Stories</button>
          <button className={`ar-tab ${tab === 'podcasts' ? 'active' : ''}`} onClick={() => setTab('podcasts')}>Podcasts</button>
        </div>

        {/* Search row — reserve the same height on both tabs so toggling
            doesn't shove the results up/down. Input on Stories; caption on
            Podcasts fills the reserved space. */}
        <div style={{ marginBottom: 26, height: 60, display: 'flex', alignItems: 'center' }}>
          {tab === 'stories' ? (
            <input
              className="ar-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the stories…"
              aria-label="Search stories"
            />
          ) : (
            <p style={{ ...mono(11), width: '100%', textAlign: 'center', margin: 0 }}>
              Every daily episode, newest first
            </p>
          )}
        </div>

        {/* One always-present content area with a reserved minimum height, so
            loading / empty / a short Podcasts list never collapse the page and
            tab switches don't produce a big vertical jump. */}
        <div style={{ minHeight: '65vh' }}>
        {initialLoading && <p style={{ ...mono(13), textAlign: 'center', padding: 40 }}>Pulling the back issues…</p>}

        {empty && (
          <p style={{ fontFamily: 'Spectral, serif', fontStyle: 'italic', fontSize: 20, textAlign: 'center', padding: 50, color: C.muted }}>
            {tab === 'stories' && debounced ? `No stories match “${debounced}”.` : 'Nothing in the archive yet.'}
          </p>
        )}

        {/* Results stay mounted while a new query loads — dim, don't unmount. */}
        {!initialLoading && !empty && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.18s ease' }}>
            {/* Stories — flat relevance list when searching, else grouped by date */}
            {tab === 'stories' && searchActive && stories.length > 0 && (
              <section>
                <DateHeader label={`Results for “${debounced}”`} />
                {stories.map(renderStory)}
              </section>
            )}
            {tab === 'stories' && !searchActive && storyGroups.map((g) => (
              <section key={g.label}>
                <DateHeader label={g.label} />
                {g.rows.map(renderStory)}
              </section>
            ))}

            {/* Podcasts */}
            {tab === 'podcasts' && podGroups.map((g) => (
              <section key={g.label}>
                <DateHeader label={g.label} />
                {g.rows.map((p) => (
                  <a
                    key={p.id}
                    href="/podcast"
                    onClick={navClick(() => router.push('podcast', {}))}
                    className="ar-card ar-link"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '54px 1fr',
                      gap: 18,
                      padding: '18px 0',
                      borderBottom: `1px solid rgba(26,23,20,0.16)`,
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ width: 54, height: 54, borderRadius: '50%', background: C.accent, color: C.paper, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <PlayIcon size={18} style={{ marginLeft: 2 }} />
                    </div>
                    <div>
                      <div style={{ ...mono(10.5, C.accent), letterSpacing: '0.16em', marginBottom: 5 }}>The Daily Podcast</div>
                      <h3 className="ar-title" style={{ fontFamily: 'Anton, sans-serif', fontWeight: 400, fontSize: 24, lineHeight: 0.98, textTransform: 'uppercase', margin: '0 0 6px' }}>{p.title}</h3>
                      <div style={mono(10.5)}>{fmtMin(p.durationMs)} · {p.articleCount} stories</div>
                    </div>
                  </a>
                ))}
              </section>
            ))}

            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 34 }}>
                <button className="ar-more" disabled={loading} onClick={() => { void loadMore(); }}>Load more →</button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
