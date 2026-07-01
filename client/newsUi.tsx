import React from 'react';
import { useRouter } from './router';
import { navClick } from './nav';

// Shared "Three Ways" UI primitives — bias bar, source chips, blindspot badge,
// and the home-page cluster sections. Same newsprint skin as HomePage/ArticlePage
// (the C palette + Anton/Spectral/IBM Plex Mono), plus two new motifs: the
// printed-rule bias bar and the rotated SATIRE stamp.

export const C = {
  paper: '#f1ece0',
  paper2: '#e9e2d2',
  ink: '#1a1714',
  muted: '#6f665a',
  accent: '#d6261d',
};

export const BIAS = { left: '#2a3b6b', center: '#9a9082', right: '#d6261d' };

export const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Anton&family=Spectral:ital,wght@0,400;0,600;1,400;1,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');";

export type BiasBucket = 'left' | 'center' | 'right';

export interface BiasBreakdown {
  left: number; center: number; right: number; unrated: number; total: number;
  leftPct: number; centerPct: number; rightPct: number;
}
export interface ClusterCard {
  id: string; title: string; category: string;
  biasBreakdown: BiasBreakdown; blindspotSide: BiasBucket | null;
  factualityAvg: number | null; articleCount: number; sourceCount: number;
  topImageUri: string | null; summary: string | null; hasUglyTake: boolean;
  lastUpdatedAt: number;
}
export interface ClusterSource {
  sourceId: string; name: string; bias: string; biasScore: number;
  factuality: string; bucket: BiasBucket;
}
export interface ClusterCoverageItem {
  fileId: string; title: string; sourceId: string | null; sourceName: string;
  bucket: BiasBucket | null; factuality: string | null; uri: string | null;
  articleCount: number;
}
export interface UglyTake { id: string; title: string; markdown: string; imageUri: string | null }
export interface ClusterFull extends ClusterCard {
  neutralSummary: string | null; framingSummary: string | null;
  sources: ClusterSource[]; coverage: ClusterCoverageItem[]; uglyTake: UglyTake | null;
}
export interface UglyTakeCard {
  clusterId: string; category: string; satireTitle: string;
  satireImageUri: string | null; satireSnippet: string; lastUpdatedAt: number;
}

export async function newsRpc<T>(name: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  const body = (await res.json()) as { result: T };
  return body.result;
}

export function factualityLabel(avg: number | null): string {
  if (avg === null) return '—';
  if (avg < 1.5) return 'VERY LOW';
  if (avg < 2.5) return 'LOW';
  if (avg < 3.5) return 'MIXED';
  if (avg < 4.5) return 'HIGH';
  return 'VERY HIGH';
}

const FACT_SHORT: Record<string, string> = {
  'very-low': 'V.LOW', low: 'LOW', mixed: 'MIXED', high: 'HIGH', 'very-high': 'V.HIGH',
};
export function factShort(f: string | null): string {
  return f ? (FACT_SHORT[f] ?? f.toUpperCase()) : '—';
}

/** The printed tri-segment coverage rule. Falls back to a neutral fill when no
 *  source in the cluster is bias-rated (e.g. only aggregators covered it). */
export function BiasBar({ b, height = 12 }: { b: BiasBreakdown; height?: number }): React.ReactElement {
  const rated = b.leftPct + b.centerPct + b.rightPct;
  return (
    <div style={{ display: 'flex', height, width: '100%', border: `1px solid ${C.ink}`, overflow: 'hidden', background: C.paper }}>
      {rated === 0 ? (
        <div style={{ width: '100%', background: BIAS.center, opacity: 0.4 }} />
      ) : (
        <>
          <div style={{ width: `${b.leftPct}%`, background: BIAS.left }} />
          <div style={{ width: `${b.centerPct}%`, background: BIAS.center }} />
          <div style={{ width: `${b.rightPct}%`, background: BIAS.right }} />
        </>
      )}
    </div>
  );
}

export function BiasLegend({ b }: { b: BiasBreakdown }): React.ReactElement {
  const item = (color: string, label: string, pct: number) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 9, height: 9, background: color, display: 'inline-block' }} />
      {label} {pct}%
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, marginTop: 8 }}>
      {item(BIAS.left, 'Left', b.leftPct)}
      {item(BIAS.center, 'Center', b.centerPct)}
      {item(BIAS.right, 'Right', b.rightPct)}
    </div>
  );
}

/** "RIGHT/LEFT BLINDSPOT" pill — `side` is the bucket that's NOT covering it. */
export function BlindspotBadge({ side }: { side: BiasBucket }): React.ReactElement {
  const color = side === 'right' ? BIAS.right : BIAS.left;
  const arrow = side === 'right' ? '◀' : '▶';
  return (
    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', border: `1.5px solid ${color}`, color, padding: '4px 9px', whiteSpace: 'nowrap' }}>
      {arrow} {side} Blindspot
    </span>
  );
}

export function SourceChip({ name, bucket, factuality, count = 1 }: { name: string; bucket: BiasBucket | null; factuality: string | null; count?: number }): React.ReactElement {
  const color = bucket ? BIAS[bucket] : C.muted;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid rgba(26,23,20,0.2)' }}>
      <span style={{ width: 9, height: 9, background: color, flex: 'none' }} />
      <span style={{ flex: 1, fontFamily: 'Spectral, serif', fontWeight: 600, fontSize: 16 }}>
        {name}{count > 1 ? <span style={{ color: C.muted, fontWeight: 400 }}> ×{count}</span> : null}
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.06em', color: C.muted, border: `1px solid ${C.muted}`, padding: '2px 6px' }}>{factShort(factuality)}</span>
    </div>
  );
}

/** Tiny dependency-free markdown → HTML (mirrors ArticlePage's renderer). */
export function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out: string[] = [];
  let list: string[] | null = null;
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^###\s/.test(line)) { flush(); out.push(`<h3>${inline(line.slice(4))}</h3>`); }
    else if (/^##\s/.test(line)) { flush(); out.push(`<h2>${inline(line.slice(3))}</h2>`); }
    else if (/^#\s/.test(line)) { flush(); out.push(`<h2>${inline(line.slice(2))}</h2>`); }
    else if (/^>\s?/.test(line)) { flush(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); }
    else if (/^[-*]\s/.test(line)) { (list ??= []).push(`<li>${inline(line.slice(2))}</li>`); }
    else if (/^---+$/.test(line)) { flush(); out.push('<hr/>'); }
    else { flush(); out.push(`<p>${inline(line)}</p>`); }
  }
  flush();
  return out.join('');
}

const kicker: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '.16em',
  textTransform: 'uppercase', color: C.muted,
};

// ─── Home sections ──────────────────────────────────────────────────────────

/** "Top Stories — see every angle": a rail of score-ranked clusters. */
export function TopStoriesRail(): React.ReactElement | null {
  const router = useRouter();
  const [items, setItems] = React.useState<ClusterCard[] | null>(null);
  React.useEffect(() => {
    let alive = true;
    newsRpc<{ items: ClusterCard[] }>('newsTopStories', { limit: 8 })
      .then((r) => { if (alive) setItems(r.items); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  if (!items || items.length === 0) return null;
  const [lead, ...rest] = items;
  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', padding: '8px clamp(20px,5vw,64px) 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '22px 0 14px' }}>
        <span style={{ fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', fontSize: 26 }}>Today, Every Angle</span>
        <span style={kicker}>the day's biggest stories, every angle</span>
      </div>
      {lead && <LeadCluster c={lead} onOpen={() => { router.push('story/:id', { id: lead.id }); }} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 22, marginTop: 24 }}>
        {rest.map((c) => (
          <a key={c.id} href={`/story/${c.id}`} onClick={navClick(() => { router.push('story/:id', { id: c.id }); })} data-id="top-story-card" style={{ textDecoration: 'none', color: C.ink, borderTop: `3px solid ${C.ink}`, paddingTop: 12, display: 'block' }}>
            <div style={{ ...kicker, color: C.accent, marginBottom: 6 }}>{c.category}</div>
            <h3 style={{ fontFamily: 'Spectral, serif', fontWeight: 600, fontSize: 18, lineHeight: 1.15, margin: '0 0 12px' }}>{c.title}</h3>
            <BiasBar b={c.biasBreakdown} height={7} />
            <div style={{ ...kicker, fontSize: 11, marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{c.sourceCount} sources · {factualityLabel(c.factualityAvg)}</span>
              {c.hasUglyTake && <UglyTakeBadge />}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function LeadCluster({ c, onOpen }: { c: ClusterCard; onOpen: () => void }): React.ReactElement {
  return (
    <article style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', border: `3px double ${C.ink}` }} className="uc-lead">
      <div style={{ minHeight: 280, borderRight: `3px double ${C.ink}`, background: c.topImageUri ? `center/cover no-repeat url(${c.topImageUri})` : `repeating-linear-gradient(45deg, rgba(26,23,20,0.10) 0 2px, transparent 2px 9px), ${C.paper2}` }} />
      <div style={{ padding: '26px 28px', display: 'flex', flexDirection: 'column' }}>
        <div style={kicker}>{c.category} · {c.sourceCount} sources</div>
        <h2 style={{ fontFamily: 'Spectral, serif', fontWeight: 600, fontSize: 'clamp(26px,3vw,40px)', lineHeight: 1.06, margin: '8px 0 14px' }}>{c.title}</h2>
        {c.summary && <p style={{ fontFamily: 'Spectral, serif', fontSize: 17, lineHeight: 1.5, color: '#2c2722', margin: '0 0 14px' }}>{c.summary}</p>}
        <div style={{ marginTop: 'auto' }}>
          <BiasBar b={c.biasBreakdown} />
          <BiasLegend b={c.biasBreakdown} />
          <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={onOpen} data-id="lead-see-all-sides" style={btn(C)}>See every angle →</button>
            {c.blindspotSide && <BlindspotBadge side={c.blindspotSide} />}
            {c.hasUglyTake && <UglyTakeBadge />}
          </div>
        </div>
      </div>
    </article>
  );
}

/** "The Blindspot" strip: stories one side is barely covering. */
export function BlindspotStrip(): React.ReactElement | null {
  const router = useRouter();
  const [items, setItems] = React.useState<ClusterCard[] | null>(null);
  React.useEffect(() => {
    let alive = true;
    newsRpc<{ items: ClusterCard[] }>('newsBlindspot', { limit: 4 })
      .then((r) => { if (alive) setItems(r.items); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', padding: '0 clamp(20px,5vw,64px)' }}>
      <div style={{ border: `3px double ${C.ink}`, margin: '34px 0' }}>
        <div style={{ background: C.accent, color: C.paper, fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', letterSpacing: '.06em', padding: '10px 18px', fontSize: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>▟ The Blindspot</span>
          <span style={{ ...kicker, color: C.paper, opacity: 0.85 }}>what one side isn't telling you</span>
        </div>
        {items.map((c, i) => (
          <a key={c.id} href={`/story/${c.id}`} onClick={navClick(() => { router.push('story/:id', { id: c.id }); })} data-id="blindspot-row" style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '16px 18px', borderBottom: i < items.length - 1 ? '1px solid rgba(26,23,20,0.25)' : 'none', textDecoration: 'none', color: C.ink }}>
            {c.blindspotSide && <BlindspotBadge side={c.blindspotSide} />}
            <h4 style={{ flex: 1, fontFamily: 'Spectral, serif', fontWeight: 600, fontSize: 19, margin: 0 }}>{c.title}</h4>
            <span style={{ ...kicker, fontSize: 12, whiteSpace: 'nowrap' }}>{c.biasBreakdown.left}L · {c.biasBreakdown.center}C · {c.biasBreakdown.right}R →</span>
          </a>
        ))}
        <a href="/blindspot" onClick={navClick(() => { router.push('blindspot', {}); })} data-id="see-all-blindspots" style={{ display: 'block', textAlign: 'center', padding: '12px 18px', ...kicker, fontSize: 12, color: C.accent, textDecoration: 'none', borderTop: '1px solid rgba(26,23,20,0.25)' }}>
          See all blindspots →
        </a>
      </div>
    </section>
  );
}

export function btn(c: typeof C, ghost = false): React.CSSProperties {
  return {
    fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', letterSpacing: '.14em',
    fontSize: 12, padding: '11px 18px', cursor: 'pointer',
    border: `2px solid ${c.ink}`,
    background: ghost ? 'transparent' : c.ink, color: ghost ? c.ink : c.paper,
  };
}

// ─── The rotated SATIRE stamp — shared by every Ugly Take surface. ───────────
export const satireStamp: React.CSSProperties = {
  display: 'inline-block', fontFamily: 'Anton, sans-serif', textTransform: 'uppercase',
  color: C.accent, border: `3px solid ${C.accent}`, padding: '5px 12px',
  transform: 'rotate(-4deg)', fontSize: 13, letterSpacing: '.14em',
};

/** Small "⌖ Ugly Take" chip for story cards that have a satire companion. */
export function UglyTakeBadge(): React.ReactElement {
  return (
    <span style={{
      display: 'inline-block', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 600,
      letterSpacing: '.1em', textTransform: 'uppercase', color: C.accent,
      border: `1.5px solid ${C.accent}`, padding: '2px 6px', whiteSpace: 'nowrap',
    }}>⌖ Ugly Take</span>
  );
}

// ─── Shared inner-page press header ──────────────────────────────────────────
type PressTab = 'home' | 'blindspot' | 'satire' | 'podcast' | 'archive';

/** Slim "The Ugly Press" header for the story/blindspot/satire/reader pages, so
 *  every inner page carries the masthead + "Left. Right. Ugly." + nav. */
export function PressHeader({ active }: { active?: PressTab }): React.ReactElement {
  const router = useRouter();
  const nav: { key: PressTab; label: string; href: string; go: () => void }[] = [
    { key: 'home', label: 'Front Page', href: '/', go: () => { router.push('', {}); } },
    { key: 'blindspot', label: 'Blindspot', href: '/blindspot', go: () => { router.push('blindspot', {}); } },
    { key: 'satire', label: 'Satire', href: '/ugly-takes', go: () => { router.push('ugly-takes', {}); } },
    { key: 'podcast', label: 'Podcast', href: '/podcast', go: () => { router.push('podcast', {}); } },
    { key: 'archive', label: 'Archive', href: '/archive', go: () => { router.push('archive', {}); } },
  ];
  return (
    <header style={{ borderTop: `6px solid ${C.ink}`, background: C.paper }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '10px clamp(16px,4vw,40px) 0', textAlign: 'center' }}>
        <a href="/" onClick={navClick(() => { router.push('', {}); })} style={{ textDecoration: 'none', color: C.ink }}>
          <div style={{ fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', fontSize: 'clamp(22px,3.4vw,30px)', letterSpacing: '.02em' }}>The Ugly Press</div>
        </a>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, letterSpacing: '.22em', textTransform: 'uppercase', color: C.muted, marginTop: 2 }}>Left. Right. Ugly.</div>
        <nav style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap', margin: '10px 0 8px' }}>
          {nav.map((n) => (
            <a key={n.key} href={n.href} onClick={navClick(n.go)} data-id={`press-nav-${n.key}`} style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: 11.5, letterSpacing: '.12em',
              textTransform: 'uppercase', textDecoration: 'none',
              color: active === n.key ? C.ink : C.muted,
              borderBottom: `2px solid ${active === n.key ? C.accent : 'transparent'}`,
              paddingBottom: 3,
            }}>{n.label}</a>
          ))}
        </nav>
      </div>
      <div style={{ borderBottom: `1px solid ${C.ink}` }} />
    </header>
  );
}

// ─── Front-page satire: the Onion-style feature + a rail of recent takes. ─────

/** One satire card tile (used in the home rail and the Satire Desk grid). */
export function UglyTakeTile({ take, onOpen }: { take: UglyTakeCard; onOpen: () => void }): React.ReactElement {
  return (
    <a href={`/ugly-take/${take.clusterId}`} onClick={navClick(onOpen)} data-id="ugly-take-tile"
       style={{ textDecoration: 'none', color: C.ink, border: `3px double ${C.ink}`, background: C.paper2, display: 'block', overflow: 'hidden' }}>
      {take.satireImageUri && (
        <div style={{ height: 128, background: `center/cover no-repeat url(${take.satireImageUri})`, borderBottom: `1px solid ${C.ink}` }} />
      )}
      <div style={{ padding: '14px 16px 18px' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: C.accent, border: `1.5px solid ${C.accent}`, padding: '2px 6px' }}>⌖ Satire</span>
        <h3 style={{ fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', fontSize: 19, lineHeight: 1.08, margin: '10px 0 0' }}>{take.satireTitle}</h3>
      </div>
    </a>
  );
}

/** Home-page "The Ugly Take" block: a big fake lead + a rail of recent takes.
 *  Fed from HomePage's shared newsUglyTakes fetch (also drives the ticker). */
export function UglyTakeSection({ takes }: { takes: UglyTakeCard[] }): React.ReactElement | null {
  const router = useRouter();
  if (takes.length === 0) return null;
  const [lead, ...rest] = takes;
  const deskItems = rest.slice(0, 3);
  const open = (id: string): void => { router.push('ugly-take/:id', { id }); };
  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', padding: '8px clamp(20px,5vw,64px) 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '34px 0 14px' }}>
        <span style={{ fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', fontSize: 26, color: C.accent }}>The Ugly Take</span>
        <a href="/ugly-takes" onClick={navClick(() => { router.push('ugly-takes', {}); })} style={{ ...kicker, color: C.accent, textDecoration: 'none' }}>the satire desk →</a>
      </div>
      {lead && (
        <a href={`/ugly-take/${lead.clusterId}`} onClick={navClick(() => open(lead.clusterId))} data-id="ugly-take-feature"
           style={{ textDecoration: 'none', color: C.ink, display: 'block' }}>
          <article className="uc-lead" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', border: `3px double ${C.ink}`, background: C.paper2 }}>
            <div style={{ minHeight: 300, borderRight: `3px double ${C.ink}`, background: lead.satireImageUri ? `center/cover no-repeat url(${lead.satireImageUri})` : `repeating-linear-gradient(-45deg, rgba(26,23,20,0.10) 0 2px, transparent 2px 9px), ${C.paper}` }} />
            <div style={{ padding: '26px 30px', display: 'flex', flexDirection: 'column' }}>
              <span style={{ ...satireStamp, alignSelf: 'flex-start', marginBottom: 14 }}>⌖ Satire — Not A Real Story</span>
              <h2 style={{ fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', fontSize: 'clamp(26px,3.2vw,44px)', lineHeight: 1.02, margin: '4px 0 14px' }}>{lead.satireTitle}</h2>
              <p style={{ fontFamily: 'Spectral, serif', fontSize: 16, lineHeight: 1.5, color: '#2c2722', margin: '0 0 16px' }}>{lead.satireSnippet}</p>
              <span style={{ ...btn(C), marginTop: 'auto', alignSelf: 'flex-start' }}>Read the Ugly Take →</span>
            </div>
          </article>
        </a>
      )}
      {deskItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 22, marginTop: 24 }}>
          {deskItems.map((t) => <UglyTakeTile key={t.clusterId} take={t} onOpen={() => open(t.clusterId)} />)}
        </div>
      )}
    </section>
  );
}
