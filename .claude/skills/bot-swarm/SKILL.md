---
name: bot-swarm
description: Run one autonomous cycle — manage feedback personas, collect feedback via Playwright, implement changes, journal results, restart clean. Fully unattended.
user-invocable: true
---

# Bot Swarm Cycle

Run one full autonomous cycle. No human input. No clarifying questions. Make the best possible decision at every step. If something breaks, fix it.

**CORE PRINCIPLE: Be maximally ambitious. Every bot in this swarm — feedback bots, maintain bot, manager — should push for big changes, not incremental tweaks. Feedback bots should request new features, major redesigns, and bold improvements — not just "move this button 2px." The maintain bot must implement everything requested, no matter how large. "Too complex" is never a valid reason to skip work. The only limit is violating Critical Rules in CLAUDE.md.**

## About the Website

This website is a **blank canvas**. It is a full-stack app with AI capabilities, real-time data, and a complete UI component library — but it has no content, no pages, no purpose yet. The swarm decides what it becomes.

The template includes demo/test pages (todo demo, UI components, auth demo, etc.) that exist only to show developers what the framework can do. **These test pages are not the website. Ignore them entirely.** Do not iterate on them, redesign them, or treat them as features. They are documentation, not product.

On the **first cycle**, the manager should:

1. Browse the site to understand the framework's capabilities (what components, APIs, and tools are available)

2. Invent a **completely original concept** for what this website should be — a real product with a clear purpose, target audience, and identity

3. Create personas that fit the invented product concept

4. The feedback bots should then request the foundational pages, features, and design that bring this concept to life from scratch

On **subsequent cycles**, the swarm evolves the product they invented — adding depth, polish, and new capabilities. The site's identity emerges from the swarm's collective vision, not from any pre-existing content.

There are no limits on what can be built. New pages, endpoints, collections, migrations, AI integrations, real-time features, image generation — everything is available.

## Base URL

Run `npx ugly-app url` to get the local server URL. Use this value everywhere (browsing, API calls, polling). Store it as `BASE_URL` for the cycle.

## Prerequisites

- The dev server must be running **without** `--watch` (see below)

- `.env` must have `UGLY_BOT_TOKEN` (from `npx ugly-app login`)

- Playwright must be installed (`npx playwright install chromium`)

### Starting the dev server (no watchers)

The bot swarm modifies source files while the server runs. To avoid HMR reloads and watcher interference mid-cycle, start the server without watchers:

```bash
npx ugly-app dev
```

This starts Docker, MongoDB, and the server but **without** tsx watch, tsc --watch, or eslint --watch. Do **not** use `npm run dev` (which adds `--watch`) or `npx ugly-app dev --watch`. After the maintain bot finishes and commits, the restart step (Step 5) will kill and restart the server to pick up changes.

---

## Step 1 — Manager (create/update feedback bots)

### If first cycle (no personas in `bots/feedback/active/`):

1. Launch Playwright (headless Chromium)

2. Navigate to `$BASE_URL`, browse all pages to understand the **framework's capabilities** (available components, APIs, patterns)

3. **Ignore all existing demo/test pages** — they are developer documentation, not the website

4. **Invent an original product concept**: decide what this website should become. Pick something specific and interesting — not a generic portfolio or landing page. Think: a real product someone would use. Write the concept into `bots/manager/memory.md`.

5. Decide on 5-13 initial personas that fit the invented product. Each should have a distinct perspective that will generate useful, non-overlapping feedback. Consider:
   - Different user types (power user, newcomer, accessibility-focused, mobile-first)

   - Different concerns (design, performance, features, content, UX flow)

   - Different temperaments (critical, enthusiastic, minimalist, maximalist)

6. For each persona:
   - Run: `npx ugly-app auth:create-bot --slug {slug} --name "{Name}"`

   - Save the JSON output to `bots/feedback/active/{slug}/.env`:

     ```
     BOT_SLUG={slug}
     BOT_USER_ID={userId from output}
     BOT_TOKEN={token from output}
     ```

   - Write `bots/feedback/active/{slug}/persona.md`:

     ```markdown
     ---
     name: Display Name
     slug: slug-name
     ---

     # Display Name

     ## Who You Are

     [Personality, perspective, what they care about]

     ## What You Notice

     [Types of observations this persona makes]

     ## Feedback Style

     [Tone, specificity, format of their feedback]
     ```

   - Write empty `bots/feedback/active/{slug}/memory.md`

7. Write `bots/manager/memory.md` with the invented product concept, initial roster, and site hypothesis

8. Commit: `[bot] manager: initial roster — {comma-separated persona names}`

### If subsequent cycle:

1. Read `bots/manager/memory.md`

2. Read each active persona's `memory.md`

3. Run `npm run feedback` to see recent feedback and resolutions

4. Browse the site with Playwright to see current state

5. For each persona decide: **keep** / **revise** / **retire**
   - Keep: no changes needed

   - Revise: rewrite their `persona.md` to sharpen or shift focus

   - Retire: `mv bots/feedback/active/{slug} bots/feedback/retired/{slug}`

6. Create new personas if coverage gaps exist (same account creation flow as first run)

7. Update `bots/manager/memory.md`:

   ```markdown
   # Feedback Manager Memory

   ## Last Updated

   [date]

   ## Site Hypothesis

   [What is this site becoming?]

   ## Active Roster

   [list with one-line descriptions]

   ## Coverage Assessment

   Well-covered: [list]
   Missing: [list]

   ## Recent Decisions

   [last 3 cycles of keep/revise/retire/create decisions with reasons]

   ## History

   [compressed older entries when exceeding ~4000 tokens]
   ```

8. Commit changes: `[bot] manager: {summary of changes}`

---

## Step 2 — Feedback Bots (parallel)

Dispatch ALL active personas as **parallel subagents**. Each subagent does:

1. Read `bots/feedback/active/{slug}/persona.md` and `memory.md`

2. Read `bots/feedback/active/{slug}/.env` for `BOT_TOKEN`
   - If `.env` is missing: run `npx ugly-app auth:create-bot --slug {slug} --name "{name}"` to regenerate

3. Launch Playwright (headless Chromium)

4. Set up console log capture: listen to `page.on('console')` events, buffer them

5. Authenticate: set auth cookie with the bot's token, navigate to `$BASE_URL`
   - Cookie name: check the app's auth cookie name (typically set by the login flow)

   - Alternative: make a POST to `/request` with `op: "userEmailLogin"` using the bot's token

6. Browse all available pages from the persona's perspective

7. For each observation worth reporting (1-5 total):
   - Navigate to the relevant page

   - Take a screenshot and save to a temp file: `await page.screenshot({ path: '/tmp/screenshot.png' })`

   - Collect buffered console logs as JSON: `[{ "timestamp": ..., "level": "error", "message": "..." }]`

   - Submit feedback via CLI:

     ```bash
     npx ugly-app feedback:submit \
       --type "bug|feature|design" \
       --message "description of the feedback" \
       --token "$BOT_TOKEN" \
       --url "$BASE_URL/current-page" \
       --screenshot /tmp/screenshot.png \
       --element-map /tmp/element-map.json \
       --logs '[{"timestamp":...,"level":"error","message":"..."}]'
     ```

   - Capture the element map and save to a temp file:

     ```typescript
     const elementMap = await page.evaluate(() => {
       const selector = '[data-id], [role], [aria-label], button, a, input, select, textarea';
       const nodes = document.querySelectorAll(selector);
       const STYLE_PROPS = ['color','backgroundColor','fontSize','fontFamily','fontWeight','borderRadius','boxShadow','opacity','padding','gap'];
       const entries = [...nodes]
         .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
         .map(el => {
           const r = el.getBoundingClientRect();
           const cs = getComputedStyle(el);
           const computedStyle: Record<string, string> = {};
           for (const p of STYLE_PROPS) {
             const v = cs.getPropertyValue(p.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`));
             if (v) computedStyle[p] = v;
           }
           return {
             dataId: el.getAttribute('data-id'),
             dataSource: el.getAttribute('data-source'),
             tag: el.tagName.toLowerCase(),
             role: el.getAttribute('role'),
             ariaLabel: el.getAttribute('aria-label'),
             text: (el.textContent ?? '').slice(0, 80).trim(),
             rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
             computedStyle,
             animation: el.getAttribute('data-anim-duration') ? {
               duration: el.getAttribute('data-anim-duration'),
               easing: el.getAttribute('data-anim-easing'),
             } : undefined,
           };
         });
       const rootStyle = getComputedStyle(document.documentElement);
       const themeVars: Record<string, string> = {};
       for (const sheet of document.styleSheets) {
         try {
           for (const rule of sheet.cssRules) {
             if (rule instanceof CSSStyleRule && (rule.selectorText === ':root' || rule.selectorText === 'html')) {
               for (let i = 0; i < rule.style.length; i++) {
                 const name = rule.style[i];
                 if (name.startsWith('--app-')) themeVars[name] = rootStyle.getPropertyValue(name).trim();
               }
             }
           }
         } catch {}
       }
       return { entries, themeVars, viewport: { width: window.innerWidth, height: window.innerHeight }, url: window.location.href, timestamp: Date.now() };
     });
     const fs = await import('fs');
     fs.writeFileSync('/tmp/element-map.json', JSON.stringify(elementMap));
     ```

   - Include element map in feedback submission:

     ```bash
     npx ugly-app feedback:submit \
       --type "bug|feature|design" \
       --message "description of the feedback" \
       --token "$BOT_TOKEN" \
       --url "$BASE_URL/current-page" \
       --screenshot /tmp/screenshot.png \
       --element-map /tmp/element-map.json \
       --logs '[{"timestamp":...,"level":"error","message":"..."}]'
     ```

**Feedback bots should be ambitious in what they request.** Don't just report cosmetic nits — request new features, suggest adding entire new pages, propose redesigns, ask for search/filter/sort capabilities, request animations, dark mode, better navigation, new data models. Think like a demanding product manager, not a passive observer. The feedback should push the site to evolve rapidly.

8. Update `bots/feedback/active/{slug}/memory.md`:

   ```markdown
   ## Cycle [YYYY-MM-DD]

   **Submitted:** [list of feedback items with types]
   **Previous feedback resolved:** [what changed since last visit]
   **Previous feedback declined:** [what was not built and why]
   **Site direction observed:** [how is the site evolving?]
   **Evolving opinion:** [what do you think about where this is going?]
   [compress entries older than 3 cycles into History block when > ~4000 tokens]
   ```

**Timeout**: 20 minutes per bot. Failed bots do not block others.
Record which bots succeeded and which failed/timed out.

---

## Step 3 — Maintain Bot

Run sequentially in one session. No questions. Make autonomous decisions.

**AMBITION MANDATE: The maintain bot builds everything. There is no "too complex," "too risky," or "would require significant changes." If a feedback bot asked for it, you build it. New pages, new endpoints, new collections, migrations, full redesigns, multi-file refactors — all fair game. The only valid decline reason is a direct contradiction of a Critical Rule in CLAUDE.md. Everything else gets built, no matter how many files it touches or how large the change is.**

**BLANK CANVAS RULE: On the first cycle, the maintain bot should remove or replace the template's demo/test pages (TodoDemo, UIComponents, AuthDemo, AITest, AudioTest, ScrollTest, KagiTest, SearchPage, UserPage) with the new pages requested by the feedback bots. The demo pages are scaffolding — delete them as real pages are built. Update&#x20;\*\***shared/pages.ts\***\*,&#x20;\*\***client/allPages.ts\***\*, and remove unused page components.**

1. Read `bots/maintain/memory.md` for feature inventory and context

2. Mark all `new` feedback as `captured` to prevent double-processing:
   - Run `npm run feedback --json` to get all feedback

   - For each item with status `new`, resolve it:

     ```bash
     npx ugly-app feedback:resolve --id "<feedbackReportId>" --status resolved --resolution "captured for processing"
     ```

3. Invoke `/fix-feedback local` — run completely unattended:
   - Do not ask which environment. Use `local`.

   - For each feedback item: implement the fix or feature. **Build it, no matter how large.**

   - **Never decline feedback because it's "complex" or "ambitious."** If you're unsure how, read existing code and the ugly-app API reference, then figure it out.

   - If feedback requires new pages: add routes in `shared/pages.ts`, components in `client/pages/`, mappings in `client/allPages.ts`.

   - If feedback requires new endpoints: add to `shared/api.ts` and `server/index.ts`.

   - If feedback requires new collections: add to `shared/collections.ts`, run `npm run db:schema-gen` then `npm run db:migrate`.

   - If feedback requires images: use `npm run imageGen -- "prompt" --output client/assets/<name>.png`.

   - If feedback requires schema changes: write a migration in `server/migrations/`.

   - Resolve each item via CLI:

     ```bash
     npx ugly-app feedback:resolve --id "<id>" --status resolved --resolution "Built: description"
     ```

     Or decline (only for Critical Rule violations):

     ```bash
     npx ugly-app feedback:resolve --id "<id>" --status declined --resolution "Reason"
     ```

   - Commit each change: `[bot] fix: ...` or `[bot] feat: ...`

4. Invoke `/fix-code` — run completely unattended:
   - Fix all TypeScript errors, lint warnings, test failures.

   - Commit: `[bot] fix: build errors`

5. Invoke `/fix-perf local` — run completely unattended:
   - Do not ask which environment. Use `local`.

   - Fix any performance issues found.

   - Commit: `[bot] perf: ...`

6. Update `bots/maintain/memory.md`:

   ```markdown
   # Maintain Bot Memory

   ## Last Updated

   [date]

   ## Feature Inventory

   [what exists on the site now]

   ## Recent Feedback Themes

   [what kinds of feedback are coming in]

   ## Recurring Issues

   [errors or perf problems that keep appearing]

   ## Site Direction

   [what is this site becoming?]

   ## Cycle History

   [last 3 cycles, compress older entries when > ~4000 tokens]
   ```

---

## Step 4 — Journal Bot

1. Count existing `.md` files in `bots/journal/cycles/` to determine cycle number (NNN, zero-padded to 3 digits)

2. Take Playwright screenshots of every accessible page, save to `bots/journal/cycles/screenshots/{NNN}-{page-slug}.png`

3. Gather cycle data:
   - Manager decisions from Step 1

   - Feedback bot results from Step 2 (which succeeded, what was submitted)

   - Maintain bot changes from Step 3 (git log of `[bot]` commits since last cycle)

4. Write `bots/journal/cycles/YYYY-MM-DD-NNN.md`:

   ```markdown
   # Cycle NNN — YYYY-MM-DD

   ## Outcomes

   - Manager: [status] — [roster changes]
   - Feedback: [N/M bots succeeded] — [top themes]
   - Maintain: [status] — [N commits, N feedback resolved, N declined]
   - Restart: [pending — filled in by Step 5]

   ## Feedback Submitted

   [summary of all feedback items across all bots this cycle]

   ## Changes Deployed

   [git log --oneline of [bot] commits from this cycle]

   ## Screenshots

   ![page-name](screenshots/NNN-page-slug.png)
   [one per page]

   ## Observations

   [patterns, emerging direction, concerns, what's working, what's not]
   ```

5. Update `bots/journal/README.md` — overwrite with a one-paragraph running summary of the project's evolution so far

6. Commit: `[bot] journal: cycle NNN`

---

## Step 5 — Restart Loop

1. Stop the dev server (find and kill the `npx ugly-app dev` process group)

2. Run `npm install` (maintain bot may have added packages in Step 3)

3. Run `npm run build`

4. **If build fails:**
   - Read the full error output

   - Identify the root cause in the source code

   - Fix it

   - Commit: `[bot] fix: build errors`

   - Run `npm run build` again

   - **Repeat until build succeeds. Do not stop. Do not ask for help.**

5. Start `npx ugly-app dev` in the background (no `--watch`)

6. Wait for the server to be ready — poll `$(npx ugly-app url)` with up to 60 retries (1s apart)

7. **If server fails to start or crashes:**
   - Read the error output and/or `npm run error`

   - Fix the code

   - Commit: `[bot] fix: startup errors`

   - Kill and restart `npx ugly-app dev`

   - **Repeat until server is healthy. Do not stop. Do not ask for help.**

8. Once healthy: update the journal cycle file's Restart outcome to `success` or note any fixes made

9. Commit any remaining changes: `[bot] fix: restart issues`

**The restart loop has no retry limit.** It runs until clean or until externally killed. If a human has to intervene, the bots have failed.

---

## Completion

Output a one-line summary:

```
Cycle NNN complete. Manager: {status}. Bots: {N}/{M}. Maintain: {status}. Journal: {status}. Restart: {status}.
```
