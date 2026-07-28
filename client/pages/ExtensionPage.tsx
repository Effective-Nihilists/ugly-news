import React from 'react';
import { buildId } from '../../shared/Build';
import { C, FONT_IMPORT, PressHeader, btn } from '../newsUi';

/**
 * The bundle the extension build produces, addressed under the BUILD PREFIX.
 *
 * `/ugly-fact-checker.zip` at the root answers 200 with the SPA HTML shell:
 * `.zip` is not in the framework's static-asset extension allowlist, so the
 * path falls through to the router. Verified against prod — the root path
 * returns 1.6KB of HTML, the prefixed path returns the real 27KB archive. A
 * "successful" download of an HTML file is exactly the kind of failure that
 * reaches a user before it reaches a log.
 */
const ZIP = `/${buildId}/ugly-fact-checker.zip`;

/**
 * Install instructions for the fact-checker extension (route `extension`).
 *
 * The download starts on arrival, because the reader clicked "Download" to get
 * here — making them hunt for a second button would be a bait and switch. The
 * manual button stays for anyone who blocked it or wants it again.
 */
export default function ExtensionPage(): React.ReactElement {
  const [started, setStarted] = React.useState(false);

  const download = React.useCallback(() => {
    const a = document.createElement('a');
    a.href = ZIP;
    a.download = 'ugly-fact-checker.zip';
    document.body.append(a);
    a.click();
    a.remove();
    setStarted(true);
  }, []);

  React.useEffect(() => {
    download();
  }, [download]);

  return (
    <div style={page}>
      <style
        dangerouslySetInnerHTML={{
          __html: `${FONT_IMPORT}
        @media (max-width: 720px) { .ext-wrap { padding: 20px 16px 60px !important; } }
      `,
        }}
      />
      <PressHeader active="extension" />

      <div className="ext-wrap" style={wrap}>
        <div style={kicker}>Browser extension</div>
        <h1 style={h1}>The Ugly Fact Checker</h1>
        <p style={lede}>
          Reads the article you are on, pulls out the factual claims, and checks
          each one against how other outlets covered it — weighted by their
          reliability, and held to “contested” when the agreement only comes
          from one side of the spectrum.
        </p>

        <div style={note} role="status">
          {started ? (
            <>
              <b>ugly-fact-checker.zip</b> is downloading. If nothing happened,{' '}
              <button
                onClick={download}
                style={linkBtn}
                data-id="download-again-inline"
              >
                download it again
              </button>
              .
            </>
          ) : (
            <>Starting your download…</>
          )}
        </div>

        <div style={warn}>
          This is not on the Chrome Web Store yet, so it installs in developer
          mode. That means Chrome will show an “unpacked extension” warning
          every time it starts — that warning is expected, not a problem with
          the download.
        </div>

        <h2 style={h2}>Installing it</h2>
        <ol style={list}>
          <li style={li}>
            <b>Unzip the file.</b> You should end up with a folder containing{' '}
            <code style={code}>manifest.json</code>. Chrome loads the{' '}
            <i>folder</i>, not the zip, so this step is not optional.
          </li>
          <li style={li}>
            Open <code style={code}>chrome://extensions</code> in a new tab.
            Typing it is easier than finding it in the menus.
          </li>
          <li style={li}>
            Turn on <b>Developer mode</b>, top right. Nothing appears to happen
            — it just reveals three buttons on the left.
          </li>
          <li style={li}>
            Click <b>Load unpacked</b> and choose the folder you unzipped.
          </li>
          <li style={li}>
            <b>Sign in at ugly.press.</b> Claim checking runs on AI billed to
            your own account, so the extension does nothing until you have a
            session. It will tell you so rather than sitting there quietly.
          </li>
        </ol>

        <h2 style={h2}>Reading the highlights</h2>
        <ul style={list}>
          <li style={li}>
            <Swatch color="#8c929e" dotted /> <b>Dotted</b> — the claim is still
            being checked.
          </li>
          <li style={li}>
            <Swatch color="#2f9e44" /> <b>Green</b> — corroborated across
            outlets on more than one side.
          </li>
          <li style={li}>
            <Swatch color="#d69614" /> <b>Amber</b> — contested, or agreed on
            only by outlets that lean the same way.
          </li>
          <li style={li}>
            <Swatch color="#e03131" /> <b>Red</b> — other coverage contradicts
            it.
          </li>
          <li style={li}>
            <Swatch color="#8c929e" /> <b>Grey</b> — nobody else covered it.
            Silence is not agreement, so it is never counted as support.
          </li>
        </ul>
        <p style={p}>
          Hover or click a highlight to see which outlets were counted, what
          each one said, and the arithmetic that produced the colour. Every
          source links to its own article, because the point is that you can go
          and check.
        </p>

        <h2 style={h2}>Updating it</h2>
        <p style={p}>
          Download again, unzip over the old folder, then press <b>Reload</b> on
          the extension’s card in <code style={code}>chrome://extensions</code>.
        </p>

        <button
          onClick={download}
          style={{ ...btn(C), marginTop: 26 }}
          data-id="download-extension"
        >
          Download again
        </button>
      </div>
    </div>
  );
}

function Swatch({
  color,
  dotted = false,
}: {
  color: string;
  dotted?: boolean;
}): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 26,
        verticalAlign: 'middle',
        marginRight: 8,
        borderBottom: `3px ${dotted ? 'dotted' : 'solid'} ${color}`,
      }}
    />
  );
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: C.paper,
  color: C.ink,
};

const wrap: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '34px 24px 80px',
};

const kicker: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 11,
  letterSpacing: '.2em',
  textTransform: 'uppercase',
  color: C.accent,
  marginBottom: 10,
};

const h1: React.CSSProperties = {
  fontFamily: 'Anton, sans-serif',
  fontSize: 46,
  lineHeight: 1.02,
  margin: '0 0 14px',
  textTransform: 'uppercase',
  textWrap: 'balance',
};

const h2: React.CSSProperties = {
  fontFamily: 'Anton, sans-serif',
  fontSize: 21,
  textTransform: 'uppercase',
  letterSpacing: '.02em',
  margin: '34px 0 12px',
};

const lede: React.CSSProperties = {
  fontFamily: 'Spectral, Georgia, serif',
  fontSize: 17,
  lineHeight: 1.6,
  margin: '0 0 22px',
};

const p: React.CSSProperties = {
  fontFamily: 'Spectral, Georgia, serif',
  fontSize: 15.5,
  lineHeight: 1.65,
  margin: '0 0 12px',
};

const list: React.CSSProperties = {
  fontFamily: 'Spectral, Georgia, serif',
  fontSize: 15.5,
  lineHeight: 1.6,
  paddingLeft: 22,
  margin: '0 0 6px',
};

const li: React.CSSProperties = { marginBottom: 11 };

const note: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 12.5,
  lineHeight: 1.6,
  background: C.paper2,
  border: `2px solid ${C.ink}`,
  padding: '12px 14px',
  marginBottom: 14,
};

const warn: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 12,
  lineHeight: 1.65,
  color: C.muted,
  borderLeft: `3px solid ${C.accent}`,
  paddingLeft: 12,
  margin: '0 0 8px',
};

const code: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: '0.9em',
  background: C.paper2,
  padding: '1px 5px',
};

const linkBtn: React.CSSProperties = {
  font: 'inherit',
  color: C.accent,
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textDecoration: 'underline',
};
