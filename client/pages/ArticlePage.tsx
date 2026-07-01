import React from 'react';
import { useRouter } from '../router';
import { navClick } from '../nav';

/** Ugly News article view (route `article/:id`). Newsprint editorial style,
 *  matching the home landing. Fetches the public newsArticleGet endpoint. */

const C = {
  paper: '#f1ece0',
  ink: '#1a1714',
  muted: '#6f665a',
  accent: '#d6261d',
};

interface Article {
  id: string;
  title: string;
  summary: string;
  markdown: string;
  thumbnailUri: string | null;
  category: string | null;
  feedId: string | null;
  sourceUri: string | null;
  clusterId: string | null;
  createdMs: number;
}

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Anton&family=Spectral:ital,wght@0,400;0,600;1,400;1,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');";

async function rpc<T>(name: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  const body = (await res.json()) as { result: T };
  return body.result;
}

/** Tiny, dependency-free markdown → HTML for the article body. */
function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
  };
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

export default function ArticlePage({ id }: { id: string }): React.ReactElement {
  const router = useRouter();
  const [article, setArticle] = React.useState<Article | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing'>('loading');

  React.useEffect(() => {
    let alive = true;
    rpc<{ article: Article | null }>('newsArticleGet', { id })
      .then((r) => {
        if (!alive) return;
        if (r.article) { setArticle(r.article); setState('ready'); }
        else setState('missing');
      })
      .catch(() => alive && setState('missing'));
    return () => { alive = false; };
  }, [id]);

  const dateStr = article
    ? new Date(article.createdMs).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }).toUpperCase()
    : '';

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
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
      <style dangerouslySetInnerHTML={{ __html: `${FONT_IMPORT}
        .ar-body { font-family: 'Spectral', serif; font-size: 19px; line-height: 1.66; color: ${C.ink}; }
        .ar-body h2 { font-family: 'Anton', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 26px; line-height: 1; margin: 28px 0 10px; }
        .ar-body h3 { font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: .1em; font-size: 14px; margin: 24px 0 8px; color: ${C.muted}; }
        .ar-body p { margin: 0 0 16px; }
        .ar-body blockquote { margin: 18px 0; padding: 6px 0 6px 18px; border-left: 3px solid ${C.accent}; font-style: italic; color: #2c2620; }
        .ar-body a { color: ${C.accent}; }
        .ar-body ul { margin: 0 0 16px; padding-left: 22px; } .ar-body li { margin: 4px 0; }
        .ar-body hr { border: none; border-top: 1px solid rgba(26,23,20,0.2); margin: 24px 0; }
        .ar-back { font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: ${C.ink}; text-decoration: none; }
        .ar-back:hover { color: ${C.accent}; }
      ` }} />
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(20px,5vw,48px)' }}>
        <div style={{ height: 6, background: C.ink, marginBottom: 18 }} />
        <a href="/" onClick={navClick(() => router.push('', {}))} className="ar-back">← The Ugly Press</a>

        {state === 'loading' && (
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', color: C.muted, marginTop: 40 }}>
            Setting type…
          </p>
        )}
        {state === 'missing' && (
          <p style={{ fontFamily: 'Spectral, serif', fontSize: 20, marginTop: 40 }}>
            This story has gone to press elsewhere. <a href="/" onClick={navClick(() => router.push('', {}))} style={{ color: C.accent }}>Back to the front page →</a>
          </p>
        )}
        {state === 'ready' && article && (
          <article style={{ marginTop: 18 }}>
            {article.category && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '.18em', textTransform: 'uppercase', color: C.accent, marginBottom: 10 }}>
                {article.category}
              </div>
            )}
            <h1 style={{ fontFamily: 'Anton, sans-serif', fontWeight: 400, fontSize: 'clamp(34px,6vw,60px)', lineHeight: 0.96, textTransform: 'uppercase', margin: '0 0 12px' }}>
              {article.title}
            </h1>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted, borderBottom: `1px solid ${C.ink}`, paddingBottom: 12, marginBottom: 20 }}>
              {dateStr}{article.feedId ? ` · via ${article.feedId}` : ''}
            </div>
            {article.clusterId && (
              <a
                href={`/story/${article.clusterId}`}
                onClick={navClick(() => router.push('story/:id', { id: article.clusterId! }))}
                data-id="see-all-sides"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: `2px solid ${C.ink}`, background: C.accent, color: C.paper, textDecoration: 'none', padding: '12px 16px', marginBottom: 22, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase' }}
              >
                <span>This story is covered across the spectrum</span>
                <span>See every angle →</span>
              </a>
            )}
            {article.thumbnailUri && (
              <img src={article.thumbnailUri} alt="" style={{ width: '100%', borderRadius: 4, marginBottom: 22, border: `1px solid rgba(26,23,20,0.15)` }} />
            )}
            <div className="ar-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(article.markdown) }} />
            {article.sourceUri && (
              <p style={{ marginTop: 28, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: C.muted }}>
                <a href={article.sourceUri} target="_blank" rel="noopener" style={{ color: C.accent }}>
                  Read the original source →
                </a>
              </p>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
