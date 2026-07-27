import { defineConfig, devices } from '@playwright/test';

// Deliberately standalone: no webServer (the default config boots `npm run dev`,
// i.e. the whole ugly-news stack, which these tests do not need) and chromium
// only — extensions do not load in firefox or webkit.
//
// channel: 'chromium' is REQUIRED and load-bearing. Playwright's default
// chromium is the OLD headless shell, which silently loads no extensions at
// all: the content script never runs and no service worker starts, with no
// error explaining why. 'chromium' selects the new headless mode, which does.
// Measured: default headless → cs=false sw=0; channel 'chromium' → cs=true sw=1.
//
// Setup: needs the HEADED chromium build, a separate download from the headless
// shell. Run `pnpm exec playwright install chromium` once.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /extension-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results-extension',
  timeout: 60_000,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
});
