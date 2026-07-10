import React from 'react';
import type { NewsPodcast } from '../../shared/news/NewsPodcast';
import { PodcastStage } from '../podcast/PodcastStage';
import { useRouter } from '../router';
import { navClick } from '../nav';
import { PlayIcon, PauseIcon } from '../components/Icon';

/**
 * The Ugly Press — Daily Podcast (route `podcast`).
 *
 * When the daily podcast is ready AND both host avatars are configured, renders
 * the 3D dancing-host stage (PodcastStage). Otherwise falls back to a newsroom
 * "on air" audio player with a live transcript + article references. Newsprint
 * aesthetic, consistent with the landing + article pages.
 */

const C = {
  paper: '#f1ece0',
  ink: '#1a1714',
  muted: '#6f665a',
  accent: '#d6261d',
};

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Anton&family=Spectral:ital,wght@0,400;0,600;1,400;1,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');";

type Podcast = NewsPodcast;

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

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Status = 'loading' | 'none' | 'recording' | 'failed' | 'ready';

export default function PodcastPage(): React.ReactElement {
  const router = useRouter();
  const [podcast, setPodcast] = React.useState<Podcast | null>(null);
  const [avatars, setAvatars] = React.useState<{ h1: string | null; h2: string | null }>({ h1: null, h2: null });
  const [status, setStatus] = React.useState<Status>('loading');
  const [playing, setPlaying] = React.useState(false);
  const [posMs, setPosMs] = React.useState(0);
  const audioRef = React.useRef<HTMLAudioElement>(null);

  const load = React.useCallback(() => {
    rpc<{ podcast: Podcast | null; host1AvatarUrl: string | null; host2AvatarUrl: string | null }>(
      'newsPodcastGetDefault',
      {},
    )
      .then((r) => {
        const p = r.podcast;
        setAvatars({ h1: r.host1AvatarUrl, h2: r.host2AvatarUrl });
        if (!p) { setStatus('none'); return; }
        setPodcast(p);
        if (p.generationStatus === 'complete' && p.audioUri) setStatus('ready');
        else if (p.generationStatus === 'failed') setStatus('failed');
        else setStatus('recording');
      })
      .catch(() => { setStatus('none'); });
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Poll while a podcast is still being recorded so the page flips to the
  // player the moment generation finishes.
  React.useEffect(() => {
    if (status !== 'recording') return;
    const id = setInterval(load, 15_000);
    return () => { clearInterval(id); };
  }, [status, load]);

  const activeSegIdx = React.useMemo(() => {
    if (!podcast) return -1;
    return podcast.segments.findIndex((s) => posMs >= s.startTimeMs && posMs < s.endTimeMs);
  }, [podcast, posMs]);

  function toggle(): void {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) { void el.play(); } else { el.pause(); }
  }
  function seekMs(ms: number): void {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    setPosMs(ms);
    if (el.paused) void el.play();
  }

  const dateStr = podcast
    ? new Date(`${podcast.date}T00:00:00Z`).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      }).toUpperCase()
    : '';
  const durMs = podcast?.durationMs ?? 0;

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
        @keyframes pp-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .pp-back { font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: ${C.ink}; text-decoration: none; }
        .pp-back:hover { color: ${C.accent}; }
        .pp-seg { cursor: pointer; transition: background 0.15s ease, padding-left 0.15s ease; border-radius: 3px; }
        .pp-seg:hover { background: rgba(26,23,20,0.05); }
        .pp-seg.active { background: rgba(214,38,29,0.08); padding-left: 10px; }
        .pp-play { cursor: pointer; border: none; background: ${C.ink}; color: ${C.paper}; width: 64px; height: 64px; border-radius: 50%; font-size: 24px; display: flex; align-items: center; justify-content: center; transition: transform 0.15s ease, background 0.2s ease; flex-shrink: 0; }
        .pp-play:hover { background: ${C.accent}; transform: scale(1.06); }
        .pp-track { appearance: none; -webkit-appearance: none; width: 100%; height: 6px; background: rgba(26,23,20,0.2); outline: none; cursor: pointer; }
        .pp-track::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: ${C.accent}; border-radius: 50%; }
        .pp-track::-moz-range-thumb { width: 16px; height: 16px; background: ${C.accent}; border: none; border-radius: 50%; }
        .pp-art { display: flex; gap: 12px; text-decoration: none; color: ${C.ink}; padding: 10px 0; border-top: 1px solid rgba(26,23,20,0.15); transition: padding-left 0.15s ease; }
        .pp-art:hover { padding-left: 6px; }
        .pp-art .t { transition: color 0.15s ease; }
        .pp-art:hover .t { color: ${C.accent}; }
      ` }} />

      <div style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(20px,5vw,48px)' }}>
        <div style={{ height: 6, background: C.ink, marginBottom: 16 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <a href="/" onClick={navClick(() => { router.push('', {}); })} className="pp-back" data-id="the-ugly-press">← The Ugly Press</a>
          <a href="/archive?tab=podcasts" onClick={navClick(() => { router.push('archive', { tab: 'podcasts' }); })} className="pp-back" data-id="all-episodes">All episodes →</a>
        </div>

        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', color: C.accent, margin: '22px 0 6px' }}>
          The Daily Ugly · Rundown → The Spread → The Ugly Take
        </div>
        <h1 style={{ fontFamily: 'Anton, sans-serif', fontWeight: 400, fontSize: 'clamp(36px,7vw,72px)', lineHeight: 0.92, textTransform: 'uppercase', margin: '0 0 8px' }}>
          {status === 'ready' && podcast ? podcast.title : 'Two hosts. Three voices.'}
        </h1>
        {dateStr && (
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted }}>
            {dateStr}
          </div>
        )}

        {status === 'loading' && (
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', color: C.muted, marginTop: 32 }}>Tuning in…</p>
        )}

        {status === 'none' && (
          <div style={{ marginTop: 28, borderTop: `4px solid ${C.ink}`, paddingTop: 20 }}>
            <p style={{ fontFamily: 'Spectral, serif', fontSize: 20, lineHeight: 1.5, maxWidth: 560 }}>
              Today’s broadcast hasn’t been recorded yet. The hosts run every morning — check back shortly,
              or read the front page in the meantime.
            </p>
            <a href="/#front" onClick={navClick(() => { router.push('', {}); })} className="pp-back" style={{ display: 'inline-block', marginTop: 14, color: C.accent }} data-id="back-to-the-headlines">
              ← Back to the headlines
            </a>
          </div>
        )}

        {status === 'recording' && (
          <div style={{ marginTop: 28, borderTop: `4px solid ${C.accent}`, paddingTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.accent }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: C.accent, animation: 'pp-pulse 1.2s infinite', display: 'inline-block' }} />
              On air — recording now
            </div>
            <p style={{ fontFamily: 'Spectral, serif', fontSize: 19, lineHeight: 1.5, maxWidth: 560, marginTop: 14 }}>
              The hosts are in the booth scripting and voicing today’s episode. This page will start playing
              automatically the moment it’s ready.
            </p>
          </div>
        )}

        {status === 'failed' && (
          <p style={{ fontFamily: 'Spectral, serif', fontSize: 20, marginTop: 28, maxWidth: 560 }}>
            Today’s recording didn’t make it to air. We’ll try again on the next cycle.
          </p>
        )}

        {status === 'ready' && podcast && (
          <>
            {podcast.description && (
              <p style={{ fontFamily: 'Spectral, serif', fontSize: 19, lineHeight: 1.5, color: C.ink, margin: '18px 0 24px', maxWidth: 640 }}>
                {podcast.description}
              </p>
            )}

            {avatars.h1 && avatars.h2 ? (
              <PodcastStage podcast={podcast} host1AvatarUrl={avatars.h1} host2AvatarUrl={avatars.h2} />
            ) : (
              <>
            {/* Player */}
            <div style={{ borderTop: `4px solid ${C.ink}`, borderBottom: `1px solid rgba(26,23,20,0.2)`, padding: '20px 0', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <button className="pp-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} data-id="toggle">
                  {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} style={{ marginLeft: 3 }} />}
                </button>
                <div style={{ flex: 1 }}>
                  <input
                    className="pp-track"
                    type="range"
                    min={0}
                    max={durMs || 1}
                    value={Math.min(posMs, durMs || 1)}
                    onChange={(e) => { seekMs(Number(e.target.value)); }} data-id="input"
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: C.muted, marginTop: 6 }}>
                    <span>{fmtTime(posMs)}</span>
                    <span>{fmtTime(durMs)}</span>
                  </div>
                </div>
              </div>
              <audio
                ref={audioRef}
                src={podcast.audioUri}
                onPlay={() => { setPlaying(true); }}
                onPause={() => { setPlaying(false); }}
                onTimeUpdate={(e) => { setPosMs(e.currentTarget.currentTime * 1000); }}
                onEnded={() => { setPlaying(false); }}
                preload="metadata"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'clamp(20px,3vw,40px)', marginTop: 18 }} className="pp-grid">
              {/* Transcript */}
              <div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.muted, marginBottom: 12 }}>
                  Transcript
                </div>
                {podcast.segments.map((s, i) => (
                  <div
                    key={i}
                    className={`pp-seg${i === activeSegIdx ? ' active' : ''}`}
                    onClick={() => { seekMs(s.startTimeMs); }}
                    style={{ padding: '8px 6px', marginBottom: 2 }} data-id="div"
                  >
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.accent, marginRight: 8 }}>
                      {s.speakerName}
                    </span>
                    <span style={{ fontFamily: 'Spectral, serif', fontSize: 17, lineHeight: 1.5 }}>{s.text}</span>
                  </div>
                ))}
              </div>

              {/* Article references */}
              <div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.muted, marginBottom: 12 }}>
                  In this episode
                </div>
                {podcast.articles.length === 0 && (
                  <p style={{ fontFamily: 'Spectral, serif', color: C.muted }}>—</p>
                )}
                {podcast.articles.map((a) => {
                  const active = posMs >= a.startTimeMs && posMs < a.endTimeMs;
                  return (
                    <a
                      key={a.fileId}
                      href={`/article/${a.fileId}`}
                      onClick={navClick(() => { router.push('article/:id', { id: a.fileId }); })}
                      className="pp-art"
                      style={active ? { background: 'rgba(214,38,29,0.06)' } : undefined} data-id="a"
                    >
                      {a.imageUri && (
                        <img src={a.imageUri} alt="" style={{ width: 64, height: 48, objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(26,23,20,0.15)' }} />
                      )}
                      <div>
                        <div className="t" style={{ fontFamily: 'Spectral, serif', fontWeight: 600, fontSize: 15, lineHeight: 1.25 }}>{a.title}</div>
                        <button
                          onClick={(e) => { e.preventDefault(); seekMs(a.startTimeMs); }}
                          style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, background: 'none', border: 'none', padding: '4px 0 0', cursor: 'pointer' }} data-id="jump-to"
                        >
                          <PlayIcon size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} /> Jump to {fmtTime(a.startTimeMs)}
                        </button>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
              </>
            )}
          </>
        )}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
