import React from 'react';
import { useApp } from 'ugly-app/client';

/**
 * Ugly News landing page (the `''` route).
 *
 * Aesthetic: satirical AI-newspaper FRONT PAGE — warm newsprint, ink-black
 * rules, a single vermilion "press stamp" accent, a running breaking-news
 * ticker, halftone grain. Anton masthead + Spectral editorial serif +
 * IBM Plex Mono datelines. Self-contained (inline styles + one <style>).
 */

const C = {
  paper: '#f1ece0',
  paper2: '#e9e2d2',
  ink: '#1a1714',
  muted: '#6f665a',
  rule: '#1a1714',
  accent: '#d6261d',
};

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Spectral:ital,wght@0,400;0,600;1,400;1,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

@keyframes un-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes un-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes un-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes un-stamp { 0% { transform: rotate(-9deg) scale(0.6); opacity: 0; } 60% { transform: rotate(-9deg) scale(1.06); opacity: 1; } 100% { transform: rotate(-9deg) scale(1); opacity: 1; } }

.un-rise { opacity: 0; animation: un-rise 0.7s cubic-bezier(0.2,0.7,0.2,1) forwards; }
.un-fade { opacity: 0; animation: un-fade 0.9s ease forwards; }

.un-link { position: relative; color: ${C.ink}; text-decoration: none; }
.un-link::after { content: ''; position: absolute; left: 0; right: 100%; bottom: -2px; height: 2px; background: ${C.accent}; transition: right 0.25s ease; }
.un-link:hover::after { right: 0; }

.un-cta { font-family: 'IBM Plex Mono', monospace; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-size: 13px;
  background: ${C.ink}; color: ${C.paper}; border: none; padding: 16px 26px; cursor: pointer; display: inline-flex; align-items: center; gap: 10px;
  text-decoration: none; transition: transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease; }
.un-cta:hover { background: ${C.accent}; transform: translate(-2px,-2px); box-shadow: 4px 4px 0 ${C.ink}; }
.un-cta.ghost { background: transparent; color: ${C.ink}; box-shadow: inset 0 0 0 2px ${C.ink}; }
.un-cta.ghost:hover { background: ${C.ink}; color: ${C.paper}; box-shadow: 4px 4px 0 ${C.accent}; }

.un-drop::first-letter { font-family: 'Anton', sans-serif; float: left; font-size: 64px; line-height: 0.78; padding: 6px 10px 0 0; color: ${C.accent}; }

.un-ticker-track { display: inline-block; white-space: nowrap; animation: un-ticker 38s linear infinite; }
.un-feature:hover .un-num { color: ${C.accent}; }

.un-card .un-card-title { transition: color 0.18s ease; }
.un-card:hover .un-card-title { color: ${C.accent}; }
.un-card-img { transition: transform 0.4s cubic-bezier(0.2,0.7,0.2,1), filter 0.3s ease; filter: grayscale(0.25) contrast(1.05); }
.un-card:hover .un-card-img { transform: scale(1.04); filter: grayscale(0) contrast(1); }
.un-row { transition: padding-left 0.18s ease; }
.un-row:hover { padding-left: 8px; }

@media (max-width: 820px) {
  .un-hero { grid-template-columns: 1fr !important; }
  .un-cols { grid-template-columns: 1fr !important; }
  .un-front-grid { grid-template-columns: 1fr !important; }
  .un-stamp { display: none !important; }
}
`;

const TICKER = [
  'AI hosts roast the headlines — humanity files complaint',
  '60+ sources, zero hold music',
  'Local newspaper replaced by something uglier',
  'Daily podcast generated while you slept',
  'Your 8 a.m. edition is brewing',
  'Breaking: the news, but honest about it',
];

const SECTIONS: { kicker: string; title: string; body: string }[] = [
  {
    kicker: 'The Wire',
    title: 'Sixty-plus sources, hourly.',
    body: 'Every hour we pull the world’s feeds, scrape the full story, and have a machine rewrite it into plain, no-filler prose. Tech, sports, food, fashion, science — the whole ugly spread, summarized so you actually finish it.',
  },
  {
    kicker: 'The Daily Podcast',
    title: 'Two hosts. No sympathy.',
    body: 'Every morning a pair of AI anchors turn the day’s biggest stories into a short, sardonic broadcast — scripted, voiced, and lip-synced. Press play and let them do the doomscrolling for you.',
  },
  {
    kicker: 'The 8 A.M. Edition',
    title: 'Delivered at your local dawn.',
    body: 'One email, personalized to what you actually read, landing at 8 a.m. wherever you are. The hero story, what’s trending, picks for you — and a link to the podcast. No 47-newsletter pileup.',
  },
];

interface NewsCard {
  id: string;
  title: string;
  summary: string;
  thumbnailUri: string | null;
  category: string | null;
  feedId: string | null;
  createdMs: number;
}

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

/** Live front page — the real, clickable headlines pulled from newsLatest. */
function FrontPage(): React.ReactElement | null {
  const [items, setItems] = React.useState<NewsCard[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    rpc<{ items: NewsCard[] }>('newsLatest', { limit: 13 })
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  // Hide the whole section until we have stories — keeps the marketing page
  // intact on a cold cache, shows the real paper once articles exist.
  if (failed || (items && items.length === 0)) return null;

  const [lead, ...rest] = items ?? [];
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();

  return (
    <section
      id="front"
      style={{ padding: 'clamp(28px,5vw,56px) clamp(20px,5vw,64px)', borderBottom: `3px double ${C.ink}` }}
    >
      <div
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 12,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: C.muted,
          borderBottom: `1px solid ${C.rule}`,
          paddingBottom: 8,
          marginBottom: 26,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Off the wire — latest</span>
        <span style={{ color: C.accent }}>{items ? `${items.length} stories` : 'loading…'}</span>
      </div>

      {!items && (
        <p style={{ fontFamily: 'IBM Plex Mono, monospace', color: C.muted }}>Setting today’s type…</p>
      )}

      {items && lead && (
        <div
          className="un-front-grid"
          style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 'clamp(20px,3vw,44px)' }}
        >
          {/* Lead story */}
          <a href={`/article/${lead.id}`} className="un-card un-lead un-fade" style={{ textDecoration: 'none', color: C.ink }}>
            {lead.thumbnailUri && (
              <div style={{ overflow: 'hidden', marginBottom: 14, border: `1px solid rgba(26,23,20,0.18)` }}>
                <img src={lead.thumbnailUri} alt="" className="un-card-img" style={{ width: '100%', display: 'block', aspectRatio: '16/9', objectFit: 'cover' }} />
              </div>
            )}
            {lead.category && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.accent, marginBottom: 8 }}>
                {lead.category}
              </div>
            )}
            <h2 className="un-card-title" style={{ fontFamily: 'Anton, sans-serif', fontWeight: 400, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 0.94, textTransform: 'uppercase', margin: '0 0 12px' }}>
              {lead.title}
            </h2>
            <p style={{ fontFamily: 'Spectral, serif', fontSize: 18, lineHeight: 1.5, margin: '0 0 8px' }}>
              {lead.summary}
            </p>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted }}>
              {fmt(lead.createdMs)}{lead.feedId ? ` · ${lead.feedId}` : ''} · Read →
            </div>
          </a>

          {/* Secondary column */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rest.map((a, i) => (
              <a
                key={a.id}
                href={`/article/${a.id}`}
                className="un-card un-row un-fade"
                style={{
                  textDecoration: 'none',
                  color: C.ink,
                  display: 'grid',
                  gridTemplateColumns: a.thumbnailUri ? '1fr 84px' : '1fr',
                  gap: 14,
                  padding: '14px 0',
                  borderTop: i === 0 ? 'none' : `1px solid rgba(26,23,20,0.18)`,
                  animationDelay: `${0.05 * i}s`,
                }}
              >
                <div>
                  {a.category && (
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.accent, marginBottom: 4 }}>
                      {a.category}
                    </div>
                  )}
                  <h3 className="un-card-title" style={{ fontFamily: 'Spectral, serif', fontWeight: 600, fontSize: 18, lineHeight: 1.2, margin: '0 0 4px' }}>
                    {a.title}
                  </h3>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
                    {fmt(a.createdMs)}{a.feedId ? ` · ${a.feedId}` : ''}
                  </div>
                </div>
                {a.thumbnailUri && (
                  <div style={{ overflow: 'hidden', border: `1px solid rgba(26,23,20,0.18)`, alignSelf: 'start' }}>
                    <img src={a.thumbnailUri} alt="" className="un-card-img" style={{ width: 84, height: 64, objectFit: 'cover', display: 'block' }} />
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function isLoggedIn(): boolean {
  return !!(window as unknown as { __AUTH_TOKEN__?: string }).__AUTH_TOKEN__;
}

/** ugly.bot OAuth popup → /auth/verify → reload (same flow as AuthDemoPage). */
function openLogin(): void {
  const w = 480, h = 640;
  window.open(
    `https://ugly.bot/oauth?origin=${encodeURIComponent(window.location.origin)}`,
    'ugly-bot-login',
    `width=${w},height=${h},left=${Math.round(window.screenX + (window.outerWidth - w) / 2)},top=${Math.round(window.screenY + (window.outerHeight - h) / 2)}`,
  );
  function onMessage(event: MessageEvent): void {
    if (event.origin !== 'https://ugly.bot') return;
    const data = event.data as { type?: string; code?: string } | null;
    if (data?.type !== 'ugly-bot-oauth' || !data.code) return;
    window.removeEventListener('message', onMessage);
    void fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: data.code }),
    }).then((res) => { if (res.ok) window.location.reload(); });
  }
  window.addEventListener('message', onMessage);
}

interface EmailPref { emailAllowed: boolean; timezone: string; lang: string }

/** The 8 A.M. Edition subscribe widget — login-gated toggle that writes the
 *  user's email preference + detected timezone (drives the 8am-local cron). */
function EmailSignup(): React.ReactElement {
  const loggedIn = isLoggedIn();
  const [pref, setPref] = React.useState<EmailPref | null>(null);
  const [busy, setBusy] = React.useState(false);
  const tz = React.useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }, []);

  React.useEffect(() => {
    if (!loggedIn) return;
    rpc<EmailPref>('newsEmailPrefGet', {}).then(setPref).catch(() => setPref({ emailAllowed: false, timezone: tz, lang: 'en' }));
  }, [loggedIn, tz]);

  async function subscribe(next: boolean): Promise<void> {
    setBusy(true);
    try {
      const r = await rpc<EmailPref>('newsEmailPrefSet', { emailAllowed: next, timezone: tz, lang: 'en' });
      setPref(r);
    } catch { /* surfaced by the disabled state */ }
    setBusy(false);
  }

  const btn: React.CSSProperties = {
    fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, letterSpacing: '0.12em',
    textTransform: 'uppercase', fontSize: 12, padding: '12px 18px', cursor: 'pointer',
    border: 'none', background: C.ink, color: C.paper, transition: 'background 0.2s ease',
  };

  if (!loggedIn) {
    return (
      <div style={{ marginTop: 14 }}>
        <button style={btn} onClick={openLogin}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.background = C.ink)}>
          Sign in with ugly.bot →
        </button>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, letterSpacing: '0.06em', color: C.muted, marginTop: 8 }}>
          Sign in to get the edition in your inbox.
        </div>
      </div>
    );
  }

  if (!pref) {
    return <div style={{ marginTop: 14, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: C.muted }}>Checking your subscription…</div>;
  }

  return (
    <div style={{ marginTop: 14 }}>
      {pref.emailAllowed ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.accent, marginBottom: 10 }}>
            ★ Subscribed — 8 a.m. {pref.timezone}
          </div>
          <button style={{ ...btn, background: 'transparent', color: C.ink, boxShadow: `inset 0 0 0 2px ${C.ink}` }} disabled={busy}
            onClick={() => { void subscribe(false); }}>
            {busy ? '…' : 'Unsubscribe'}
          </button>
        </>
      ) : (
        <>
          <button style={btn} disabled={busy}
            onClick={() => { void subscribe(true); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.accent)}
            onMouseLeave={(e) => (e.currentTarget.style.background = C.ink)}>
            {busy ? 'Subscribing…' : 'Email me at 8 a.m. →'}
          </button>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, letterSpacing: '0.06em', color: C.muted, marginTop: 8 }}>
            Delivered 8 a.m. in {pref.timezone}.
          </div>
        </>
      )}
    </div>
  );
}

function Masthead({ dateStr }: { dateStr: string }): React.ReactElement {
  return (
    <header style={{ padding: '0 clamp(20px,5vw,64px)' }}>
      <div style={{ height: 8, background: C.ink, marginTop: 14 }} />
      <div
        className="un-fade"
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: C.muted,
          textAlign: 'center',
          padding: '10px 0 4px',
        }}
      >
        AI-curated · Brutally summarized · Forever free
      </div>
      <h1
        className="un-rise"
        style={{
          fontFamily: 'Anton, sans-serif',
          fontWeight: 400,
          fontSize: 'clamp(52px, 13vw, 168px)',
          lineHeight: 0.84,
          letterSpacing: '0.01em',
          textAlign: 'center',
          margin: '2px 0 6px',
          color: C.ink,
          textTransform: 'uppercase',
        }}
      >
        The Ugly Press
      </h1>
      <div style={{ height: 3, background: C.ink }} />
      <div style={{ height: 1, background: C.ink, marginTop: 3 }} />
      <div
        className="un-fade"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: C.ink,
          padding: '8px 0 0',
        }}
      >
        <span>{dateStr}</span>
        <span style={{ color: C.accent }}>★ Late City Final ★</span>
        <span>Vol. I · No. 1 · ugly.press</span>
      </div>
    </header>
  );
}

function Ticker(): React.ReactElement {
  const run = [...TICKER, ...TICKER];
  return (
    <div
      style={{
        background: C.accent,
        color: C.paper,
        overflow: 'hidden',
        borderTop: `3px solid ${C.ink}`,
        borderBottom: `3px solid ${C.ink}`,
        margin: '18px 0 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div
          style={{
            background: C.ink,
            color: C.paper,
            fontFamily: 'IBM Plex Mono, monospace',
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '9px 16px',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Breaking
        </div>
        <div style={{ overflow: 'hidden', flex: 1 }}>
          <div
            className="un-ticker-track"
            style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 12.5,
              letterSpacing: '0.06em',
              padding: '9px 0',
            }}
          >
            {run.map((t, i) => (
              <span key={i} style={{ padding: '0 28px' }}>
                {t}
                <span style={{ opacity: 0.55 }}> ◆ </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero({ name }: { name?: string | undefined }): React.ReactElement {
  const lines = ['The news,', 'minus the', 'noise.'];
  return (
    <section
      className="un-hero"
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1.55fr 1fr',
        gap: 'clamp(24px, 4vw, 56px)',
        padding: 'clamp(28px,5vw,56px) clamp(20px,5vw,64px) 8px',
        borderBottom: `3px double ${C.ink}`,
      }}
    >
      <div>
        <div
          className="un-rise"
          style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 12,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: C.accent,
            marginBottom: 10,
          }}
        >
          The front page, rewritten by a machine
        </div>
        {lines.map((line, i) => (
          <div
            key={i}
            className="un-rise"
            style={{
              fontFamily: 'Anton, sans-serif',
              fontSize: 'clamp(44px, 9vw, 110px)',
              lineHeight: 0.86,
              letterSpacing: '0.005em',
              color: C.ink,
              textTransform: 'uppercase',
              animationDelay: `${0.1 + i * 0.09}s`,
            }}
          >
            {line}
            {i === 2 ? <span style={{ color: C.accent }}>.</span> : null}
          </div>
        ))}
      </div>

      <div
        className="un-fade"
        style={{
          animationDelay: '0.45s',
          alignSelf: 'end',
          borderLeft: `1px solid ${C.rule}`,
          paddingLeft: 'clamp(16px,2vw,28px)',
        }}
      >
        <p
          className="un-drop"
          style={{
            fontFamily: 'Spectral, serif',
            fontSize: 18,
            lineHeight: 1.5,
            color: C.ink,
            margin: '0 0 18px',
          }}
        >
          {name ? `Morning, ${name}. ` : ''}Ugly Press reads the entire internet
          so you don’t have to — sixty-plus feeds, scraped and summarized every
          hour, plus a daily podcast and a personal edition in your inbox.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a href="#front" className="un-cta">
            Read today →
          </a>
          <a href="#daily" className="un-cta ghost">
            Get the 8 a.m.
          </a>
        </div>
      </div>

      <div
        className="un-stamp"
        style={{
          position: 'absolute',
          top: 'clamp(16px,3vw,30px)',
          right: 'clamp(20px,5vw,64px)',
          animation: 'un-stamp 0.7s 0.6s cubic-bezier(0.2,0.8,0.2,1) both',
          border: `3px solid ${C.accent}`,
          color: C.accent,
          fontFamily: 'IBM Plex Mono, monospace',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding: '8px 12px',
          textAlign: 'center',
          lineHeight: 1.3,
          background: 'rgba(214,38,29,0.05)',
        }}
      >
        Edition
        <br />
        Daily
      </div>
    </section>
  );
}

function Sections(): React.ReactElement {
  return (
    <section
      id="sections"
      style={{ padding: 'clamp(28px,5vw,56px) clamp(20px,5vw,64px)' }}
    >
      <div
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 12,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: C.muted,
          borderBottom: `1px solid ${C.rule}`,
          paddingBottom: 8,
          marginBottom: 26,
        }}
      >
        Inside today’s edition
      </div>
      <div
        className="un-cols"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'clamp(20px,3vw,40px)',
        }}
      >
        {SECTIONS.map((s, i) => (
          <article
            key={s.kicker}
            id={i === 2 ? 'daily' : undefined}
            className="un-feature un-fade"
            style={{
              animationDelay: `${0.15 + i * 0.12}s`,
              borderTop: `4px solid ${C.ink}`,
              paddingTop: 16,
            }}
          >
            <div
              className="un-num"
              style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: C.ink,
                transition: 'color 0.2s ease',
                marginBottom: 8,
              }}
            >
              §{i + 1} — {s.kicker}
            </div>
            <h3
              style={{
                fontFamily: 'Anton, sans-serif',
                fontWeight: 400,
                fontSize: 'clamp(24px, 2.6vw, 32px)',
                lineHeight: 0.96,
                textTransform: 'uppercase',
                color: C.ink,
                margin: '0 0 12px',
              }}
            >
              {s.title}
            </h3>
            <p
              className="un-drop"
              style={{
                fontFamily: 'Spectral, serif',
                fontSize: 16,
                lineHeight: 1.55,
                color: C.ink,
                margin: 0,
              }}
            >
              {s.body}
            </p>
            {i === 0 && (
              <a href="#front" className="un-link" style={{ display: 'inline-block', marginTop: 14, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink }}>
                Read the wire →
              </a>
            )}
            {i === 1 && (
              <a href="/podcast" className="un-link" style={{ display: 'inline-block', marginTop: 14, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink }}>
                Open the podcast →
              </a>
            )}
            {i === 2 && <EmailSignup />}
          </article>
        ))}
      </div>
    </section>
  );
}

function Manifesto(): React.ReactElement {
  return (
    <section
      style={{
        background: C.ink,
        color: C.paper,
        padding: 'clamp(48px,8vw,96px) clamp(20px,5vw,64px)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontFamily: 'Spectral, serif',
          fontStyle: 'italic',
          fontWeight: 600,
          fontSize: 'clamp(26px, 5vw, 56px)',
          lineHeight: 1.12,
          maxWidth: 1000,
          margin: '0 auto',
        }}
      >
        <span style={{ color: C.accent, fontFamily: 'Anton', fontStyle: 'normal' }}>
          “
        </span>
        All the news that’s fit to summarize — and a lot that isn’t.
        <span style={{ color: C.accent, fontFamily: 'Anton', fontStyle: 'normal' }}>
          ”
        </span>
      </div>
      <div
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 12,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'rgba(241,236,224,0.55)',
          marginTop: 24,
        }}
      >
        — The Editors (there are no editors)
      </div>
    </section>
  );
}

function FinalCTA(): React.ReactElement {
  return (
    <section
      style={{
        padding: 'clamp(48px,7vw,88px) clamp(20px,5vw,64px)',
        textAlign: 'center',
        borderBottom: `8px solid ${C.ink}`,
      }}
    >
      <h2
        style={{
          fontFamily: 'Anton, sans-serif',
          fontWeight: 400,
          fontSize: 'clamp(36px, 7vw, 88px)',
          lineHeight: 0.9,
          textTransform: 'uppercase',
          color: C.ink,
          margin: '0 0 22px',
        }}
      >
        Start reading the
        <br />
        <span style={{ color: C.accent }}>ugly</span> truth.
      </h2>
      <a href="#top" className="un-cta">
        Open the newsroom →
      </a>
    </section>
  );
}

export default function HomePage(): React.ReactElement {
  const app = useApp() as { user?: { name?: string } | null } | undefined;
  const name = app?.user?.name ?? undefined;
  const dateStr = new Date()
    .toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    .toUpperCase();

  return (
    <div
      id="top"
      style={{
        height: '100%',
        overflowY: 'auto',
        background: C.paper,
        color: C.ink,
        overflowX: 'hidden',
        backgroundImage:
          'radial-gradient(rgba(26,23,20,0.05) 1px, transparent 1px)',
        backgroundSize: '3px 3px',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <Masthead dateStr={dateStr} />
      <Ticker />
      <Hero name={name} />
      <FrontPage />
      <Sections />
      <Manifesto />
      <FinalCTA />
      <footer
        style={{
          padding: '26px clamp(20px,5vw,64px)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: C.muted,
        }}
      >
        <span>The Ugly Press · ugly.press</span>
        <span>
          Printed by{' '}
          <a className="un-link" href="https://ugly.bot" style={{ color: C.ink }}>
            ugly.bot
          </a>
        </span>
      </footer>
    </div>
  );
}
