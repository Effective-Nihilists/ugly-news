import React from 'react';
import { useRouter } from '../router';
import { navClick } from '../nav';
import {
  BiasBar,
  BlindspotBadge,
  C,
  FONT_IMPORT,
  PressHeader,
  btn,
  newsRpc,
  type ClusterCard,
} from '../newsUi';

/** "The Blindspot" feed (route `blindspot`): clusters one side is barely
 *  covering, with the coverage gap made explicit. */
export default function BlindspotPage(): React.ReactElement {
  const router = useRouter();
  const [items, setItems] = React.useState<ClusterCard[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    newsRpc<{ items: ClusterCard[] }>('newsBlindspot', { limit: 24 })
      .then((r) => {
        if (alive) setItems(r.items);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={pageStyle}>
      <style
        dangerouslySetInnerHTML={{
          __html: `${FONT_IMPORT}
        @media (max-width: 820px) { .bs-grid { grid-template-columns: 1fr !important; } }
      `,
        }}
      />
      <PressHeader active="blindspot" />
      <div
        style={{
          maxWidth: 1040,
          margin: '0 auto',
          padding: 'clamp(18px,4vw,40px)',
        }}
      >
        <a
          href="/"
          onClick={navClick(() => {
            router.push('', {});
          })}
          style={backLink}
          data-id="back-to-front-page"
        >
          ‹ back to front page
        </a>

        <header style={{ textAlign: 'center', padding: '14px 0 6px' }}>
          <div
            style={{
              fontFamily: 'Anton, sans-serif',
              textTransform: 'uppercase',
              color: C.accent,
              fontSize: 'clamp(40px,8vw,86px)',
              lineHeight: 0.9,
            }}
          >
            The Blindspot
          </div>
          <div
            style={{
              fontFamily: 'Spectral, serif',
              fontStyle: 'italic',
              fontSize: 20,
              color: '#2c2722',
              marginTop: 10,
            }}
          >
            Stories one side is barely covering. The gap is the story.
          </div>
        </header>

        {items === null && (
          <p
            style={{
              ...mono,
              color: C.muted,
              textAlign: 'center',
              marginTop: 30,
            }}
          >
            Finding the gaps…
          </p>
        )}
        {items !== null && items.length === 0 && (
          <p
            style={{
              fontFamily: 'Spectral, serif',
              fontSize: 19,
              textAlign: 'center',
              marginTop: 30,
            }}
          >
            No blindspots right now — coverage is unusually even. Check back
            after the next sweep.
          </p>
        )}

        {items !== null && items.length > 0 && (
          <section
            className="bs-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 22,
              marginTop: 26,
            }}
          >
            {items.map((c) => (
              <article
                key={c.id}
                style={{
                  border: `3px double ${C.ink}`,
                  padding: '20px 22px',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {c.blindspotSide && (
                  <div style={{ marginBottom: 12 }}>
                    <BlindspotBadge side={c.blindspotSide} />
                  </div>
                )}
                <h3
                  style={{
                    fontFamily: 'Spectral, serif',
                    fontWeight: 600,
                    fontSize: 24,
                    lineHeight: 1.1,
                    margin: '0 0 12px',
                  }}
                >
                  {c.title}
                </h3>
                {c.summary && (
                  <p
                    style={{
                      fontFamily: 'Spectral, serif',
                      fontSize: 16,
                      lineHeight: 1.5,
                      color: '#2c2722',
                      margin: '0 0 16px',
                    }}
                  >
                    {c.summary}
                  </p>
                )}
                <BiasBar b={c.biasBreakdown} height={14} />
                <div
                  style={{
                    ...mono,
                    fontSize: 11,
                    letterSpacing: '.06em',
                    textTransform: 'uppercase',
                    color: C.muted,
                    marginTop: 10,
                  }}
                >
                  {c.biasBreakdown.left} left · {c.biasBreakdown.center} center
                  · {c.biasBreakdown.right} right
                </div>
                <div style={{ marginTop: 'auto', paddingTop: 16 }}>
                  <a
                    href={`/story/${c.id}`}
                    onClick={navClick(() => {
                      router.push('story/:id', { id: c.id });
                    })}
                    data-id="blindspot-see-all-sides"
                    style={{
                      ...btn(C),
                      display: 'inline-block',
                      textDecoration: 'none',
                    }}
                  >
                    See every angle →
                  </a>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  background: C.paper,
  color: C.ink,
  boxSizing: 'border-box',
  paddingTop: 'env(safe-area-inset-top)',
  paddingBottom: 'env(safe-area-inset-bottom)',
  paddingLeft: 'env(safe-area-inset-left)',
  paddingRight: 'env(safe-area-inset-right)',
  backgroundImage: 'radial-gradient(rgba(26,23,20,0.05) 1px, transparent 1px)',
  backgroundSize: '3px 3px',
};
const mono: React.CSSProperties = { fontFamily: 'IBM Plex Mono, monospace' };
const backLink: React.CSSProperties = {
  ...mono,
  fontSize: 12,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: C.muted,
  textDecoration: 'none',
};
