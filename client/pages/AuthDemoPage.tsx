import React from 'react';
import { Button, Card, PageLayout, Text, useApp } from 'ugly-app/client';

function openLogin(): void {
  window.open(
    `https://ugly.bot/oauth?origin=${encodeURIComponent(
      window.location.origin,
    )}`,
    'ugly-bot-login',
    `width=480,height=640,left=${Math.round(
      window.screenX + (window.outerWidth - 480) / 2,
    )},top=${Math.round(window.screenY + (window.outerHeight - 640) / 2)}`,
  );
  function onMessage(event: MessageEvent): void {
    if (event.origin !== 'https://ugly.bot') return;
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

function AuthDemoAuthenticated(): React.ReactElement {
  const app = useApp();

  async function handleLogout(): Promise<void> {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  }

  return (
    <PageLayout
      header={
        <div>
          <a href="/">← Home</a>
        </div>
      }
    >
      <div>
        <h1>Auth Demo</h1>
        <Card>
          <p>Logged in</p>
          <pre>
            {JSON.stringify(
              {
                userId: app.userId,
                email: app.user.email,
                phone: app.user.phone,
              },
              null,
              2,
            )}
          </pre>
          <Button variant="secondary" onClick={() => { void handleLogout(); }}>
            Logout
          </Button>
        </Card>
      </div>
    </PageLayout>
  );
}

function AuthDemoUnauthenticated(): React.ReactElement {
  return (
    <PageLayout
      header={
        <div>
          <a href="/">← Home</a>
        </div>
      }
    >
      <div>
        <h1>Auth Demo</h1>
        <Card>
          <Text>You are not logged in.</Text>
          <Button onClick={openLogin}>Login with ugly.bot</Button>
        </Card>
      </div>
    </PageLayout>
  );
}

export default function AuthDemoPage(): React.ReactElement {
  const isLoggedIn = !!(window as unknown as { __AUTH_TOKEN__?: string })
    .__AUTH_TOKEN__;
  if (isLoggedIn) return <AuthDemoAuthenticated />;
  return <AuthDemoUnauthenticated />;
}
