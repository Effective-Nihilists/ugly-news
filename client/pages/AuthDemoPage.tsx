import React from 'react';
import {
  Button,
  Card,
  PageLayout,
  Text,
  startUglyBotLogin,
  useApp,
} from 'ugly-app/client';

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
          <a href="/" data-id="home">
            ← Home
          </a>
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
          <Button
            variant="secondary"
            onClick={() => {
              void handleLogout();
            }}
            data-id="logout"
          >
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
          <a href="/" data-id="home-2">
            ← Home
          </a>
        </div>
      }
    >
      <div>
        <h1>Auth Demo</h1>
        <Card>
          <Text>You are not logged in.</Text>
          <Button
            onClick={() => {
              startUglyBotLogin();
            }}
            data-id="login-with-ugly-bot"
          >
            Login with ugly.bot
          </Button>
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
