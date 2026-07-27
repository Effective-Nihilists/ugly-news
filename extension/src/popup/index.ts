import type { Bias } from '../../../shared/news/schemas';
import { GET_REPORT, type PageReport } from '../shared/messages';

// Keyed by the full Bias union so adding a bias value is a compile error here,
// not a silently-grey chip. Anchored on newsUi's left/center/right constants.
const BIAS_COLOR: Record<Bias, string> = {
  'far-left': '#1d2a4d',
  left: '#2a3b6b',
  'lean-left': '#4a5a8a',
  center: '#9a9082',
  'lean-right': '#c05a4a',
  right: '#d6261d',
  'far-right': '#9e1a12',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function sourceCard(report: PageReport): string {
  const r = report.rating;
  if (r === null) {
    return `<div class="card"><div class="glyph" style="background:var(--faint)">?</div>
      <div><div class="nm">Unrated source</div>
      <div class="meta">${escapeHtml(report.host)}<br>No published reliability rating.</div>
      </div></div>`;
  }
  const color = BIAS_COLOR[r.bias];
  const sign = r.biasScore >= 0 ? '+' : '';
  return `<div class="card">
    <div class="glyph" style="background:${color}">${escapeHtml(r.name.slice(0, 1))}</div>
    <div>
      <div class="nm">${escapeHtml(r.name)}</div>
      <div class="meta">
        <span class="pill" style="background:color-mix(in srgb, ${color} 18%, transparent);color:${color}">
          ${escapeHtml(r.bias)} ${sign}${String(r.biasScore)}</span>
        factuality: <b>${escapeHtml(r.factuality)}</b><br>
        ${escapeHtml(r.owner ?? 'Unknown owner')}${r.country === null ? '' : ' · ' + escapeHtml(r.country)}
      </div>
    </div></div>`;
}

function ladder(report: PageReport): string {
  const engaged = report.verdict.engage;
  const rows: [string, string, string][] = [
    [
      'Tier 0 · page shape',
      engaged ? 'pass' : 'stop',
      engaged ? 'Article' : 'Stopped',
    ],
    [
      'Tier 1 · publisher',
      engaged ? (report.rating === null ? 'skip' : 'pass') : 'skip',
      engaged ? (report.rating === null ? 'Unrated' : 'Rated') : 'Skipped',
    ],
    ['Tier 2 · corpus', 'skip', 'Not in this build'],
    ['Tier 3 · claims', 'skip', 'Not in this build'],
  ];
  return rows
    .map(
      ([k, cls, v]) =>
        `<div class="row ${cls}"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`,
    )
    .join('');
}

async function render(): Promise<void> {
  const root = document.getElementById('root');
  if (root === null) return;

  const report: PageReport | null = await chrome.runtime.sendMessage({
    type: GET_REPORT,
  });

  if (report === null) {
    root.innerHTML = `<div class="why">No reading for this tab yet. Reload the page and try again.</div>`;
    return;
  }

  root.innerHTML =
    sourceCard(report) +
    `<div class="lab">${report.verdict.engage ? 'Status' : 'Dormant'}</div>` +
    `<div class="why">${escapeHtml(report.verdict.reason)}</div>` +
    `<div class="lab">The gate</div>` +
    ladder(report);
}

void render();
