import React from 'react';
import { useRouter } from '../router';
import { navClick } from '../nav';
import {
  C,
  FONT_IMPORT,
  PressHeader,
  btn,
  newsRpc,
  renderMarkdown,
  satireStamp,
  type ClusterFull,
} from '../newsUi';

/** The Ugly Take reader (route `ugly-take/:id`, id = clusterId): leads with the
 *  joke (Onion-style), then bridges back to the real coverage. Reuses the
 *  existing newsClusterGet RPC, which already returns `cluster.uglyTake`. */
export default function UglyTakePage({ id }: { id: string }): React.ReactElement {
  const router = useRouter();
  const [cluster, setCluster] = React.useState<ClusterFull | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing'>('loading');

  React.useEffect(() => {
    let alive = true;
    newsRpc<{ cluster: ClusterFull | null }>('newsClusterGet', { id })
      .then((r) => {
        if (!alive) return;
        if (r.cluster?.uglyTake) { setCluster(r.cluster); setState('ready'); }
        else setState('missing');
      })
      .catch(() => { if (alive) setState('missing'); });
    return () => { alive = false; };
  }, [id]);

  const take = cluster?.uglyTake ?? null;

  return (
    <div style={pageStyle}>
      <style dangerouslySetInnerHTML={{ __html: `${FONT_IMPORT}
        .uc-body { font-family: 'Spectral', serif; font-size: 19px; line-height: 1.66; color: ${C.ink}; }
        .uc-body h2 { font-family: 'Anton', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 22px; margin: 24px 0 8px; }
        .uc-body p { margin: 0 0 16px; } .uc-body strong { font-weight: 600; }
        .uc-body blockquote { margin: 14px 0; padding: 4px 0 4px 16px; border-left: 3px solid ${C.accent}; font-style: italic; color: #2c2722; }
      ` }} />
      <PressHeader active="satire" />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(18px,4vw,40px)' }}>
        <a href="/ugly-takes" onClick={navClick(() => { router.push('ugly-takes', {}); })} style={backLink} data-id="the-satire-desk">‹ The Satire Desk</a>

        {state === 'loading' && <p style={{ ...mono, color: C.muted, marginTop: 40 }}>Consulting the satire desk…</p>}
        {state === 'missing' && (
          <p style={{ fontFamily: 'Spectral, serif', fontSize: 20, marginTop: 40 }}>
            No Ugly Take here. <a href="/ugly-takes" onClick={navClick(() => { router.push('ugly-takes', {}); })} style={{ color: C.accent }} data-id="back-to-the-satire">Back to the Satire Desk →</a>
          </p>
        )}

        {state === 'ready' && cluster && take && (
          <article style={{ marginTop: 18 }}>
            <span style={{ ...satireStamp, fontSize: 15, marginBottom: 16 }}>⌖ Satire — Not A Real Story</span>
            <div style={{ ...mono, fontSize: 12, letterSpacing: '.16em', color: C.muted, margin: '16px 0 6px' }}>
              {cluster.category.toUpperCase()} · THE UGLY PRESS SATIRE DESK
            </div>
            {take.imageUri && (
              <img src={take.imageUri} alt="" style={{ width: '100%', maxHeight: 340, objectFit: 'cover', border: `1px solid ${C.ink}`, margin: '10px 0 22px' }} />
            )}
            <div className="uc-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(take.markdown) }} />

            <div style={{ borderTop: `3px double ${C.ink}`, marginTop: 30, paddingTop: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Spectral, serif', fontStyle: 'italic', fontSize: 17, color: '#2c2722', flex: 1, minWidth: 200 }}>
                Curious what actually happened?
              </span>
              <a href={`/story/${cluster.id}`} onClick={navClick(() => { router.push('story/:id', { id: cluster.id }); })} data-id="ugly-take-see-coverage" style={{ ...btn(C), display: 'inline-block', textDecoration: 'none' }}>See the real coverage →</a>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  height: '100%', overflowY: 'auto', background: C.paper, color: C.ink, boxSizing: 'border-box',
  paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
  paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)',
  backgroundImage: 'radial-gradient(rgba(26,23,20,0.05) 1px, transparent 1px)', backgroundSize: '3px 3px',
};
const mono: React.CSSProperties = { fontFamily: 'IBM Plex Mono, monospace' };
const backLink: React.CSSProperties = { ...mono, fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted, textDecoration: 'none' };
