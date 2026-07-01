import React from 'react';
import { useRouter } from '../router';
import { navClick } from '../nav';
import {
  BiasBar,
  BiasLegend,
  BlindspotBadge,
  C,
  FONT_IMPORT,
  SourceChip,
  factualityLabel,
  newsRpc,
  renderMarkdown,
  type BiasBucket,
  type ClusterFull,
  type ClusterCoverageItem,
} from '../newsUi';

/** The "Every story, every angle" cluster page (route `story/:id`):
 *  The Spread (bias bar) → What Happened / How Each Side Frames It →
 *  Coverage by Side → the labeled Ugly Take. */
export default function ClusterPage({ id }: { id: string }): React.ReactElement {
  const router = useRouter();
  const [cluster, setCluster] = React.useState<ClusterFull | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing'>('loading');

  React.useEffect(() => {
    let alive = true;
    newsRpc<{ cluster: ClusterFull | null }>('newsClusterGet', { id })
      .then((r) => {
        if (!alive) return;
        if (r.cluster) { setCluster(r.cluster); setState('ready'); }
        else setState('missing');
      })
      .catch(() => { if (alive) setState('missing'); });
    return () => { alive = false; };
  }, [id]);

  const byBucket = (bucket: BiasBucket): ClusterCoverageItem[] =>
    cluster ? cluster.coverage.filter((x) => x.bucket === bucket) : [];

  return (
    <div style={pageStyle}>
      <style dangerouslySetInnerHTML={{ __html: `${FONT_IMPORT}
        .uc-body { font-family: 'Spectral', serif; font-size: 18px; line-height: 1.6; color: ${C.ink}; }
        .uc-body h2 { font-family: 'Anton', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 22px; margin: 22px 0 8px; }
        .uc-body p { margin: 0 0 14px; } .uc-body strong { font-weight: 600; }
        .uc-body blockquote { margin: 14px 0; padding: 4px 0 4px 16px; border-left: 3px solid ${C.accent}; font-style: italic; color: #2c2722; }
        .uc-frame strong { display:block; margin-top:10px; }
        @media (max-width: 820px) { .uc-two { grid-template-columns: 1fr !important; } .uc-two .uc-what { border-right: 0 !important; border-bottom: 3px double ${C.ink}; } .uc-cov { grid-template-columns: 1fr !important; } .uc-lead { grid-template-columns: 1fr !important; } }
      ` }} />
      <div style={{ maxWidth: 940, margin: '0 auto', padding: 'clamp(18px,4vw,40px)' }}>
        <a href="/" onClick={navClick(() => { router.push('', {}); })} style={backLink}>‹ back to front page</a>

        {state === 'loading' && <p style={{ ...mono, color: C.muted, marginTop: 40 }}>Pulling every angle…</p>}
        {state === 'missing' && (
          <p style={{ fontFamily: 'Spectral, serif', fontSize: 20, marginTop: 40 }}>
            This story has gone to press elsewhere. <a href="/" onClick={navClick(() => { router.push('', {}); })} style={{ color: C.accent }}>Back to the front page →</a>
          </p>
        )}

        {state === 'ready' && cluster && (
          <>
            <div style={{ ...mono, fontSize: 12, letterSpacing: '.16em', color: C.muted, marginTop: 16 }}>
              {cluster.category.toUpperCase()} · {cluster.sourceCount} SOURCES · {cluster.articleCount} ARTICLES
            </div>
            <h1 style={{ fontFamily: 'Spectral, serif', fontWeight: 600, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.04, margin: '6px 0 16px' }}>
              {cluster.title}
            </h1>

            {/* THE SPREAD */}
            <section style={{ border: `3px double ${C.ink}`, padding: '20px 24px', margin: '6px 0 28px' }}>
              <div style={{ fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', fontSize: 22, marginBottom: 14 }}>The Spread</div>
              <BiasBar b={cluster.biasBreakdown} height={18} />
              <BiasLegend b={cluster.biasBreakdown} />
              <div style={{ ...mono, fontSize: 12, letterSpacing: '.06em', color: C.muted, marginTop: 14, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>Factuality: {factualityLabel(cluster.factualityAvg)}</span>
                {cluster.blindspotSide
                  ? <BlindspotBadge side={cluster.blindspotSide} />
                  : <span>No blindspot — covered across the board</span>}
              </div>
            </section>

            {/* WHAT HAPPENED / HOW EACH SIDE FRAMES IT */}
            {(cluster.neutralSummary || cluster.framingSummary) ? (
              <section className="uc-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: `3px double ${C.ink}`, marginBottom: 28 }}>
                <div className="uc-what" style={{ padding: '22px 24px', borderRight: `3px double ${C.ink}` }}>
                  <h3 style={colHead}>What Happened</h3>
                  {cluster.neutralSummary
                    ? <div className="uc-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(cluster.neutralSummary) }} />
                    : <p style={{ ...mono, color: C.muted }}>The wire desk is still writing the neutral account.</p>}
                </div>
                <div style={{ padding: '22px 24px' }}>
                  <h3 style={colHead}>How Each Side Frames It</h3>
                  {cluster.framingSummary
                    ? <div className="uc-body uc-frame" dangerouslySetInnerHTML={{ __html: renderMarkdown(cluster.framingSummary) }} />
                    : <p style={{ ...mono, color: C.muted }}>Needs coverage from more than one side.</p>}
                </div>
              </section>
            ) : null}

            {/* COVERAGE BY SIDE */}
            <section style={{ marginBottom: 30 }}>
              <div style={{ fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', fontSize: 22, marginBottom: 14 }}>Coverage by Side</div>
              <div className="uc-cov" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 22 }}>
                {(['left', 'center', 'right'] as const).map((bucket) => {
                  const items = byBucket(bucket);
                  return (
                    <div key={bucket}>
                      <h4 style={{ ...mono, fontSize: 12, letterSpacing: '.12em', margin: '0 0 12px', paddingBottom: 8, borderBottom: `2px solid ${C.ink}`, color: bucket === 'left' ? '#2a3b6b' : bucket === 'right' ? C.accent : C.muted }}>
                        ● {bucket.toUpperCase()} ({items.length})
                      </h4>
                      {items.length === 0
                        ? <div style={{ ...mono, fontSize: 12, color: C.muted, padding: '9px 0' }}>Largely uncovered</div>
                        : items.map((x) =>
                            x.uri
                              ? <a key={x.fileId} href={x.uri} target="_blank" rel="noopener noreferrer" data-id="coverage-source-link" style={{ textDecoration: 'none', color: C.ink, display: 'block' }}><SourceChip name={x.sourceName} bucket={x.bucket} factuality={x.factuality} count={x.articleCount} /></a>
                              : <SourceChip key={x.fileId} name={x.sourceName} bucket={x.bucket} factuality={x.factuality} count={x.articleCount} />,
                          )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* THE UGLY TAKE (labeled satire) */}
            {cluster.uglyTake && (
              <section style={{ position: 'relative', border: `3px double ${C.ink}`, background: C.paper2, padding: '26px 28px 30px', marginBottom: 50 }}>
                <span style={satireStamp}>⌖ Satire — Not A Real Story</span>
                {cluster.uglyTake.imageUri && (
                  <img src={cluster.uglyTake.imageUri} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', border: `1px solid ${C.ink}`, margin: '12px 0 18px' }} />
                )}
                <div className="uc-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(cluster.uglyTake.markdown) }} />
              </section>
            )}
          </>
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
const colHead: React.CSSProperties = { fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', fontSize: 17, margin: '0 0 14px', paddingBottom: 8, borderBottom: `1px solid ${C.ink}` };
const satireStamp: React.CSSProperties = { display: 'inline-block', fontFamily: 'Anton, sans-serif', textTransform: 'uppercase', color: C.accent, border: `3px solid ${C.accent}`, padding: '5px 12px', transform: 'rotate(-4deg)', fontSize: 13, letterSpacing: '.14em', marginBottom: 12 };
