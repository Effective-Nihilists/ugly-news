import { nanoid } from 'nanoid';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, PageLayout, Text, useApp } from 'ugly-app/client';

// ─── Session helpers ──────────────────────────────────────────────────────────

function getSessionId(): string {
  const key = 'sessionId';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = nanoid();
  sessionStorage.setItem(key, id);
  return id;
}

// Lightweight HTTP RPC helper for pages that run before socket auth.
// For authenticated pages with a socket, use socket.request() instead.
async function rpc<T>(name: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  const json = (await res.json()) as { result: T };
  return json.result;
}

// ─── CTA label per experiment branch ─────────────────────────────────────────

function getCtaLabel(branches: Record<string, string>): string {
  // Add more experiment-driven labels here as you add experiments.
  // 'cta-test' must match the experiment id in shared/experiments.ts.
  if (branches['cta-test'] === 'treatment') return 'Try it free';
  return 'Get started'; // control branch (or default while loading)
}

// ─── Page components ──────────────────────────────────────────────────────────

const UGLY_BOT_URL = (window as unknown as Record<string, string>).__UGLY_BOT_URL__ ?? 'https://ugly.bot';

function openLogin(): void {
  window.open(
    `${UGLY_BOT_URL}/oauth?origin=${encodeURIComponent(
      window.location.origin,
    )}`,
    'ugly-bot-login',
    `width=480,height=640,left=${Math.round(
      window.screenX + (window.outerWidth - 480) / 2,
    )},top=${Math.round(window.screenY + (window.outerHeight - 640) / 2)}`,
  );

  function onMessage(event: MessageEvent): void {
    if (event.origin !== UGLY_BOT_URL) return;
    const data = event.data as { type?: string; code?: string } | null;
    if (!data?.type || data.type !== 'ugly-bot-oauth' || !data.code) return;
    window.removeEventListener('message', onMessage);
    void fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: data.code }),
    }).then((res) => {
      if (res.ok) window.location.reload();
    });
  }
  window.addEventListener('message', onMessage);
}

function HomePageAuthenticated(): React.ReactElement {
  const app = useApp();

  async function handleLogout(): Promise<void> {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  }

  return (
    <PageLayout
      header={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px' }}>
          <Text size="lg" weight="bold">My App</Text>
          <Button variant="secondary" onClick={() => { void handleLogout(); }}>
            Logout
          </Button>
        </div>
      }
    >
      <HomePageBody userId={app.userId} />
    </PageLayout>
  );
}

function HomePageUnauthenticated(): React.ReactElement {
  return (
    <PageLayout
      header={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px' }}>
          <Text size="lg" weight="bold">My App</Text>
          <Button variant="primary" onClick={openLogin}>
            Login
          </Button>
        </div>
      }
    >
      <HomePageBody userId={null} />
    </PageLayout>
  );
}

// Rendered for both authenticated and unauthenticated users.
// The experiment CTA is intentionally shown only when userId is null.
function HomePageBody({
  userId,
}: {
  userId: string | null;
}): React.ReactElement {
  const sessionId = useRef(getSessionId());
  const [branches, setBranches] = useState<Record<string, string>>({});

  // Initialise session: captures SESSION_START and returns experiment branches.
  // Failures are silently swallowed so analytics never block the UI.
  useEffect(() => {
    rpc<{ branches: Record<string, string> }>('initSession', {
      sessionId: sessionId.current,
    })
      .then(({ branches: b }) => { setBranches(b); })
      .catch(() => {
        // Degrade gracefully — UI uses default branch values
      });
  }, []);

  function handleCtaClick(): void {
    // Fire-and-forget — do not await or block on analytics
    void rpc<{ eventId: string }>('captureEvent', {
      eventName: 'CTA_CLICK',
      sessionId: sessionId.current,
      properties: { page: 'home' },
    }).catch((_e: unknown) => undefined);

    openLogin();
  }

  const ctaLabel = getCtaLabel(branches);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <Text size="xl" weight="bold">
          Welcome
        </Text>
        <Text style={{ marginTop: 4 }}>
          {userId
            ? `Logged in as: ${userId}`
            : 'This app was built with ugly-app.'}
        </Text>
        {!userId && (
          <div style={{ marginTop: 12 }}>
            {/* CTA label is experiment-driven — see shared/experiments.ts */}
            <Button variant="primary" onClick={handleCtaClick}>
              {ctaLabel}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function HomePage(): React.ReactElement {
  // Check both that a token exists AND that AppProvider is available.
  // When the token is present but invalid (e.g. expired), the socket
  // connection fails and we render without AppProvider — so we must
  // fall back to the unauthenticated view to avoid a useApp() crash
  // that causes an infinite reload loop.
  let isLoggedIn = false;
  try {
    // useApp throws if there is no AppProvider ancestor
    useApp();
    isLoggedIn = true;
  } catch {
    isLoggedIn = false;
  }
  if (isLoggedIn) return <HomePageAuthenticated />;
  return <HomePageUnauthenticated />;
}
