> **RETIRED (2026-10-25).** This app's production servers were shut down on purpose: its
> Cloudflare cron triggers, custom domain, workers.dev URL and queue consumers were removed. Code, data
> (Neon/D1/R2) and Worker secrets are kept. **Do not deploy, publish, or restart it**, and skip it in
> fleet sweeps, bumps and rollouts. `deploy` scripts are disabled in package.json, and the `retired` key in `.uglyapp` makes `ugly-app deploy` / `deploy:assets` refuse to run (ugly-app >= 0.1.1084). Restoring needs the
> owner's explicit go-ahead; the pre-shutdown state is in
> `~/Documents/GitHub/retired-apps-cloudflare-snapshot-2026-10-25.json`, and a normal `ugly-app deploy`
> re-creates the crons, domain and consumers.

# Agent pointer

This is an **ugly-app child app**. It has no `docker-compose.yml` and no `.env`. Infra (Postgres, NATS, storage, vector search) is provisioned by ugly.bot and reached over a WebSocket called the DataProxy.

Before doing infra / data / migration work:

1. **Run `npx ugly-app doctor`** — single-command diagnostic. It reports `.uglyapp` state, auth token presence, DataProxy connectivity, and pending migrations, plus the obvious next step.
2. **Read `node_modules/ugly-app/AGENTS.md`** — the framework's own agent guide. Covers the config model, CLI catalog, seed-script pattern (`bootstrapInfra()`), and common failure modes.

Everything a human or LLM agent needs to know about the framework is in those two places. Prefer them over grepping `node_modules/ugly-app/dist` source.
