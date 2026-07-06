import React from 'react';
import type { NewsPodcast, PodcastArticleReference } from '../../shared/news/NewsPodcast';
import { PodcastSceneManager } from './PodcastSceneManager';
import { usePodcastPlayer } from './usePodcastPlayer';

/**
 * The Ugly Press dancing-host podcast stage. Renders two full-body 3D avatars
 * (lip-synced via visemes, dancing + gesturing per segment) on a WebGL canvas,
 * driven by `usePodcastPlayer`, with a newsprint-styled playback overlay.
 *
 * Avatar primitives come from `ugly-app/three/client`; this player is
 * ugly.press-specific and lives here.
 */

const C = { paper: '#f1ece0', ink: '#1a1714', muted: '#6f665a', accent: '#d6261d' };

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function PodcastStage({
  podcast,
  host1AvatarUrl,
  host2AvatarUrl,
}: {
  podcast: NewsPodcast;
  host1AvatarUrl: string;
  host2AvatarUrl: string;
}): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [sceneManager, setSceneManager] = React.useState<PodcastSceneManager | null>(null);
  const [status, setStatus] = React.useState('Setting the stage…');

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let manager: PodcastSceneManager | null = null;
    let disposed = false;

    const t = setTimeout(() => {
      const rect = container.getBoundingClientRect();
      const width = rect.width || 960;
      const height = rect.height || 540;
      try {
        manager = new PodcastSceneManager({ canvas, width, height, pixelRatio: window.devicePixelRatio });
      } catch (err) {
        setStatus('This browser couldn’t start the 3D stage.');
        console.error('[PodcastStage] scene init failed', err);
        return;
      }
      void (async () => {
        try {
          setStatus('Bringing the hosts in…');
          await manager.addAvatar('host1', host1AvatarUrl, { x: -0.65, y: 0, z: 0, rotationY: 0.25 });
          await manager.addAvatar('host2', host2AvatarUrl, { x: 0.65, y: 0, z: 0, rotationY: -0.25 });
          if (disposed) { manager.dispose(); return; }
          manager.start();
          const first = podcast.segments[0];
          manager.focusCamera(first?.speakerId === podcast.host1BotId ? 'host1' : 'host2', 0);
          setSceneManager(manager);
          setStatus('');
        } catch (err) {
          setStatus('Couldn’t load the hosts.');
          console.error('[PodcastStage] avatar load failed', err);
        }
      })();
    }, 80);

    const onResize = (): void => {
      if (!manager || !container) return;
      const r = container.getBoundingClientRect();
      manager.resize(r.width, r.height);
    };
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
      manager?.dispose();
    };
  }, [host1AvatarUrl, host2AvatarUrl, podcast]);

  const player = usePodcastPlayer({ podcast, sceneManager });

  // Auto-play once the scene + audio are ready.
  React.useEffect(() => {
    if (sceneManager && player.isLoaded && !player.isPlaying) player.togglePlayPause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneManager, player.isLoaded]);

  const sub = player.currentSubtitle;
  const seg = player.currentSegment;
  const speakerName = seg?.speakerName ?? '';

  return (
    <div style={{ border: `3px solid ${C.ink}`, background: C.ink, position: 'relative' }}>
      {/* 3D stage */}
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', background: '#0e0c0a' }}
      >
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        {status && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.paper, fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {status}
          </div>
        )}
        {/* ON AIR badge */}
        <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 8, background: C.accent, color: C.paper, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '5px 10px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.paper, animation: 'pp-pulse 1.2s infinite' }} />
          On Air
        </div>
        {/* Live caption */}
        {sub && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px 16px 14px', background: 'linear-gradient(to top, rgba(14,12,10,0.92), rgba(14,12,10,0))' }}>
            {speakerName && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.accent, marginBottom: 4 }}>
                {speakerName}
              </div>
            )}
            <div style={{ fontFamily: 'Spectral, serif', fontSize: 'clamp(16px,2.2vw,22px)', lineHeight: 1.35, color: C.paper, maxWidth: 760 }}>
              {sub.text}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ background: C.paper, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          onClick={() => { player.togglePlayPause(); }}
          aria-label={player.isPlaying ? 'Pause' : 'Play'}
          style={{ flexShrink: 0, width: 48, height: 48, borderRadius: '50%', border: 'none', background: C.ink, color: C.paper, fontSize: 18, cursor: 'pointer' }}
        >
          {player.isPlaying ? '❙❙' : '▶'}
        </button>
        <div style={{ flex: 1 }}>
          <input
            type="range"
            min={0}
            max={player.durationMs || 1}
            value={Math.min(player.currentTimeMs, player.durationMs || 1)}
            onChange={(e) => { player.seekTo(Number(e.target.value)); }}
            style={{ width: '100%', accentColor: C.accent, cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: C.muted, marginTop: 2 }}>
            <span>{fmt(player.currentTimeMs)}</span>
            <span>{fmt(player.durationMs)}</span>
          </div>
        </div>
      </div>

      {/* Article chips */}
      {podcast.articles.length > 0 && (
        <div style={{ background: C.paper, borderTop: `1px solid rgba(26,23,20,0.15)`, padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {podcast.articles.map((a: PodcastArticleReference, i: number) => {
            const active = player.currentArticle?.fileId === a.fileId;
            return (
              <button
                key={a.fileId}
                onClick={() => { player.seekToArticle(i); }}
                title={a.title}
                style={{
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, letterSpacing: '0.04em',
                  textTransform: 'uppercase', padding: '6px 10px', cursor: 'pointer',
                  border: `1px solid ${active ? C.accent : 'rgba(26,23,20,0.3)'}`,
                  background: active ? C.accent : 'transparent', color: active ? C.paper : C.ink,
                  maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {i + 1}. {a.title}
              </button>
            );
          })}
        </div>
      )}

      <audio ref={player.audioRef} src={podcast.audioUri} preload="auto" />
      <style dangerouslySetInnerHTML={{ __html: '@keyframes pp-pulse{0%,100%{opacity:1}50%{opacity:.3}}' }} />
    </div>
  );
}
