import type { Bias } from '../../../shared/news/schemas';
import {
  BILLING_URL,
  GET_REPORT,
  LOGIN_URL,
  OPEN_URL,
  type FactStatus,
  type OpenUrlMessage,
  type PageReport,
} from '../shared/messages';

// Keyed by the full Bias union so adding a bias value is a compile error here,
// not a silently grey chip. Anchored on newsUi's left/center/right constants.
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

/**
 * Either actionable state BLOCKS the popup — a single clear action, with no
 * source card or gate ladder underneath. A half-working panel hides why
 * nothing happened; this says exactly what to do.
 */
function blockingScreen(status: Exclude<FactStatus, 'ok'>): string {
  if (status === 'signed-out') {
    return `<div class="block">
      <div class="block-h">Sign in to continue</div>
      <div class="block-p">Claim checking is billed to your account, so the
        checker needs you signed in.</div>
      <button class="act" data-url="${LOGIN_URL}">Sign in to ugly.press</button>
    </div>`;
  }
  return `<div class="block">
    <div class="block-h">Out of credit</div>
    <div class="block-p">Your ugly.bot balance is empty, so the checker cannot
      run.</div>
    <button class="act" data-url="${BILLING_URL}">Add funds</button>
  </div>`;
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
    ['Tier 3 · claims', engaged ? 'pass' : 'skip', engaged ? 'Checked' : 'Skipped'],
  ];
  return rows
    .map(
      ([k, cls, v]) =>
        `<div class="row ${cls}"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`,
    )
    .join('');
}

function wireButtons(root: HTMLElement): void {
  for (const btn of Array.from(root.querySelectorAll('button[data-url]'))) {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (url === null) return;
      const msg: OpenUrlMessage = { type: OPEN_URL, url };
      void chrome.runtime.sendMessage(msg);
      window.close();
    });
  }
}

async function render(): Promise<void> {
  const root = document.getElementById('root');
  if (root === null) return;

  const reply: { report: PageReport | null; status: FactStatus } | null =
    await chrome.runtime.sendMessage({ type: GET_REPORT });

  // Blocking states win over everything, including a missing report.
  if (reply !== null && reply.status !== 'ok') {
    root.innerHTML = blockingScreen(reply.status);
    wireButtons(root);
    return;
  }

  const report = reply?.report ?? null;
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
