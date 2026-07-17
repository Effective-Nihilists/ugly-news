import React from 'react';
import { useRouter } from '../router';
import {
  C,
  FONT_IMPORT,
  PressHeader,
  UglyTakeTile,
  newsRpc,
  type UglyTakeCard,
} from '../newsUi';

/** "The Satire Desk" (route `ugly-takes`): every labeled Ugly Take, newest-first.
 *  The whole page wears the SATIRE stamp so it's unmistakably fiction. */
export default function SatireDeskPage(): React.ReactElement {
  const router = useRouter();
  const [items, setItems] = React.useState<UglyTakeCard[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    newsRpc<{ items: UglyTakeCard[] }>('newsUglyTakes', { limit: 24 })
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
        @media (max-width: 620px) { .sd-grid { grid-template-columns: 1fr !important; } }
      `,
        }}
      />
      <PressHeader active="satire" />
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: 'clamp(18px,4vw,40px)',
        }}
      >
        <header style={{ textAlign: 'center', padding: '6px 0 6px' }}>
          <div
            style={{
              fontFamily: 'Anton, sans-serif',
              textTransform: 'uppercase',
              color: C.accent,
              fontSize: 'clamp(40px,8vw,86px)',
              lineHeight: 0.9,
            }}
          >
            The Satire Desk
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
            The Ugly Take on the day's news. None of it happened. All of it is
            true.
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
            Waking the satire desk…
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
            No Ugly Takes yet — the desk is still sharpening its pencils. Check
            back after the next sweep.
          </p>
        )}

        {items !== null && items.length > 0 && (
          <section
            className="sd-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 22,
              marginTop: 26,
            }}
          >
            {items.map((t) => (
              <UglyTakeTile
                key={t.clusterId}
                take={t}
                onOpen={() => {
                  router.push('ugly-take/:id', { id: t.clusterId });
                }}
              />
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
