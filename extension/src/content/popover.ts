import { factualityWeight, type Stance } from '../../../shared/news/fact-tally';
import type { Band } from './highlight';

/**
 * The in-page verdict card.
 *
 * Rendered into a CLOSED shadow root: the host page's CSS cannot reach in and
 * restyle a fact-check verdict, and nothing we ship leaks out onto the page.
 */

export interface PopoverSource {
  name: string;
  bias: string;
  factuality: string;
  stance: Stance;
  independence: number;
}

export interface PopoverData {
  text: string;
  band: Band;
  forcedYellowReason: 'variance' | 'single-bucket' | null;
  counted: number;
  sources: PopoverSource[];
}

export interface RowMath {
  rows: { source: PopoverSource; weight: number; contribution: number }[];
  sumWeight: number;
  sumSigned: number;
  score: number;
}

function direction(s: Stance): number {
  if (s === 'supports') return 1;
  if (s === 'refutes') return -1;
  return 0;
}

/**
 * Derive the arithmetic FROM the rows being rendered, never alongside them.
 *
 * If the number were passed in next to the table, any later filtering of the
 * table would silently desynchronise the two, and a verdict whose shown working
 * does not add up is worse than one that shows no working at all.
 */
export function rowMath(sources: readonly PopoverSource[]): RowMath {
  const rows = sources.map((source) => {
    const weight =
      factualityWeight(
        source.factuality as Parameters<typeof factualityWeight>[0],
      ) * source.independence;
    return { source, weight, contribution: weight * direction(source.stance) };
  });
  const sumWeight = rows.reduce((a, r) => a + r.weight, 0);
  const sumSigned = rows.reduce((a, r) => a + r.contribution, 0);
  return {
    rows,
    sumWeight,
    sumSigned,
    score: sumWeight === 0 ? 0 : sumSigned / sumWeight,
  };
}

const BAND_LABEL: Record<Band, string> = {
  green: 'Corroborated',
  yellow: 'Contested',
  red: 'Disputed',
  grey: 'Unverified',
  pending: 'Checking…',
};

const BAND_COLOR: Record<Band, string> = {
  green: '#2f9e44',
  yellow: '#d69614',
  red: '#e03131',
  grey: '#8c929e',
  pending: '#8c929e',
};

const REASON_TEXT: Record<'variance' | 'single-bucket', string> = {
  'variance': 'Held to contested: sources on both sides carry real weight.',
  'single-bucket':
    'Held to contested: every supporting outlet sits on one side of the spectrum.',
};

const CONTAINER_ID = 'ugly-fact-popover-host';

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

const CSS_TEXT = `
:host{all:initial}
.card{position:fixed;z-index:2147483647;width:340px;max-height:60vh;overflow:auto;
 background:#f4efe6;color:#221c14;border-radius:12px;padding:13px 14px;
 box-shadow:0 10px 34px rgba(0,0,0,.28);
 font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){.card{background:#221c15;color:#ece4d6}}
.hd{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.bd{font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
.x{margin-left:auto;cursor:pointer;border:none;background:transparent;
 color:inherit;font:inherit;opacity:.6;padding:2px 4px}
.q{font-size:12px;line-height:1.5;opacity:.9;margin-bottom:10px}
.why{font-size:11px;opacity:.75;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:10.5px}
th{text-align:left;font-weight:700;opacity:.6;padding:3px 4px;
 font-size:9px;letter-spacing:.08em;text-transform:uppercase}
td{padding:3px 4px;border-top:1px solid rgba(120,105,80,.18)}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.sum{margin-top:9px;padding-top:8px;border-top:1px solid rgba(120,105,80,.28);
 font-size:10.5px;font-variant-numeric:tabular-nums;opacity:.85}
.none{font-size:11px;opacity:.7}
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function ensureRoot(): ShadowRoot {
  if (root !== null) return root;
  host = document.createElement('div');
  host.id = CONTAINER_ID;
  // Closed: the page cannot reach in via element.shadowRoot either.
  root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  root.append(style);
  document.body.append(host);
  return root;
}

export function closePopover(): void {
  const card = root?.querySelector('.card');
  card?.remove();
}

export function openPopover(data: PopoverData, x: number, y: number): void {
  const shadow = ensureRoot();
  closePopover();

  const math = rowMath(data.sources);
  const body =
    math.rows.length === 0
      ? `<div class="none">No rated outlet in the corpus addressed this claim.
         Silence is not agreement, so it stays unverified.</div>`
      : `<table><thead><tr><th>Source</th><th>Stance</th><th class="n">w</th>
         <th class="n">w·s</th></tr></thead><tbody>${math.rows
           .map(
             (r) =>
               `<tr><td>${esc(r.source.name)}<br><span style="opacity:.55">${esc(r.source.bias)} · ${esc(r.source.factuality)}</span></td>
                <td>${esc(r.source.stance)}</td>
                <td class="n">${r.weight.toFixed(2)}</td>
                <td class="n">${r.contribution >= 0 ? '+' : ''}${r.contribution.toFixed(2)}</td></tr>`,
           )
           .join('')}</tbody></table>
         <div class="sum">Σ(w·s) ${math.sumSigned >= 0 ? '+' : ''}${math.sumSigned.toFixed(2)}
          ÷ Σw ${math.sumWeight.toFixed(2)} =
          <b>${math.score >= 0 ? '+' : ''}${math.score.toFixed(2)}</b></div>`;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    `<div class="hd"><span class="dot" style="background:${BAND_COLOR[data.band]}"></span>
     <span class="bd" style="color:${BAND_COLOR[data.band]}">${BAND_LABEL[data.band]}</span>
     <button class="x" aria-label="Close">✕</button></div>
     <div class="q">“${esc(data.text)}”</div>` +
    (data.forcedYellowReason === null
      ? ''
      : `<div class="why">${REASON_TEXT[data.forcedYellowReason]}</div>`) +
    body;

  card.querySelector('.x')?.addEventListener('click', () => {
    closePopover();
  });
  shadow.append(card);

  // Anchor near the click, then pull back inside the viewport. Measured AFTER
  // insertion — a card sized before layout positions against the wrong box.
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const left = Math.max(8, Math.min(x + 12, window.innerWidth - w - 8));
  const top =
    y + 14 + h > window.innerHeight ? Math.max(8, y - h - 10) : y + 14;
  card.style.left = `${String(left)}px`;
  card.style.top = `${String(top)}px`;
}
