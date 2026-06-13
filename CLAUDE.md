# Project — ugly-app

Full API reference: https://www.npmjs.com/package/ugly-app

## Stack
- `server/index.ts` — Express + WebSocket server
- Database: PostgreSQL (JSONB) + Qdrant (vector search), MongoDB (legacy, being migrated)
- `client/main.tsx` — React SPA entry
- `shared/` — API definitions, types, collections (used by both sides)
- CLI: see `package.json` scripts

## Commands
- `npm run dev` — Start everything (Docker, server, Vite, tsc watch, eslint watch)
- `npm run build` — Production build
- `npm run db:migrate` — Run pending migrations
- `npm run db:schema-gen` — Generate migration files for schema changes
- `npm run db:schema-status` — Show current schema drift status
- `npm run db:migrate-postgres` — Migrate data from MongoDB to PostgreSQL
- `npm run textGen -- "your prompt"` — Generate text using AI from the CLI
- `npm run imageGen -- "your prompt"` — Generate an image using AI (prints URL)
- `npm run error:dev` / `npm run error:prod` — Query error logs (your dev-tunnel sessions / production)
- `npm run perf:dev` / `npm run perf:prod` — Query perf logs (your dev-tunnel sessions / production)
- `npm run feedback:dev` / `npm run feedback:prod` — Query feedback (your dev-tunnel sessions / production)
  - All commands go through the HTTP API and require `ugly-app login`. `:dev` filters by your devTunnelId.
- `npm run dev-logs` — Show local dev logs from JSONL files
- `npx ugly-app url` — Print the local dev server URL (from `.uglyapp` config)
- `npx ugly-app feedback:submit` — Submit feedback to local server (use `--help` for flags)
- `npx ugly-app feedback:resolve` — Resolve/decline a feedback item (use `--help` for flags)
- `npx ugly-app deploy` — Build and deploy to production infrastructure
- `npx ugly-app prod --buildId <id>` — Promote a build to production
- `npx ugly-app versions` — List deployed versions with status
- `npx ugly-app versions:prune` — Clean up non-production versions and old artifacts
- `npx ugly-app infra:destroy` — Tear down all project infrastructure

## Adding an endpoint
1. Define in `shared/api.ts` using `req()` (public) or `authReq()` (authenticated) + Zod schemas
2. Add handler to the `requests` object in `server/index.ts` (typed with `satisfies RequestHandlers<typeof requests>`)
3. Import `db`, `storage`, `textGen(userId)`, `imageGen(userId)`, etc. from `'ugly-app/server'` directly

### Handler signatures
```typescript
// req() — public, userId may be null
getPublicData: async (userId: string | null, input) => { ... }

// authReq() — authenticated, 401 auto-enforced, userId always a string
submitFeedback: async (userId: string, input) => { ... }
```

### Optional per-endpoint rate limiting
```typescript
submitFeedback: authReq({
  input: z.object({ ... }),
  output: z.object({ ... }),
  rateLimit: { max: 20, window: 60 },  // 20 requests per 60 seconds
})
```

Every endpoint is accessible via both WebSocket (`socket.request(name, input)`) and HTTP (`POST /api/:name { input }`).

## Adding a collection
1. Define the Zod schema and derive the type in `shared/collections.ts`:
   ```typescript
   export const TodoSchema = z.object({ userId: z.string(), text: z.string(), done: z.boolean() });
   export type Todo = InferDocType<typeof TodoSchema>;
   ```
2. Add the collection to `defineCollections()` with `schema: TodoSchema`
3. Run `npm run db:schema-gen` to generate a migration, fix any `REPLACE_ME` values, then run `npm run db:migrate`
- Optional: add `search: { fields: ['title', 'body'] }` to collection meta for full-text search
- Optional: add `vector: { dimensions: 512, source: 'body' }` to collection meta for vector search

## Changing a collection schema
1. Update the Zod schema in `shared/collections.ts`
2. Run `npm run db:schema-gen` — generates a migration file with compile-blocking placeholders
3. Fix all `REPLACE_ME` values in the generated migration
4. Run `npm run db:migrate` to apply the migration
5. The app will refuse to start until the migration is applied

## Pages & routing
- Define routes in `shared/pages.ts` with `definePage()` / `definePages()`
- Map routes to components in `client/allPages.ts` using `lazyPage()` or `lazyPageLoader()`
- Navigate: `useRouter().push('route-key', params)`
- Popups: always use `useRouter().openPopup(<Component />, { mode: 'transient' })` — never custom fixed overlays

## Critical rules
- **Never** change a collection schema without running `npm run db:schema-gen` and fixing the generated migration
- **Always** include a `schema: ZodSchema` when defining a collection — it's required
- **Never** use in-memory Maps or module-level variables for per-user state — use NATS KV or PostgreSQL (multi-server)
- **Never** commit `.env`
- **Never** read `process.env` in client code — use `import.meta.env.VITE_*`
- **Always** call `unsub()` on NATS subscriptions
- **Always** declare `rateLimit` in the endpoint def for expensive operations (AI, storage, email)
- **Never** add `any` types — `noExplicitAny` is enforced

## Element identification rules
- **Always** use framework components (Button, Pressable, TabPicker, Pager, ScrollView,
  Input, SelectView, Modal, FlatList) instead of raw HTML elements for interactive UI
- **Always** pass `data-id` on interactive elements — use descriptive kebab-case names
  (e.g., `data-id="save-profile"`, `data-id="tab-settings"`, `data-id="nav-home"`)
- **Never** build custom tab, carousel, scroll, or modal components — use the framework
  versions which include accessibility attributes and element map support
- **Always** set `aria-label` on icon-only buttons and non-text interactive elements

## Feedback system
Feedback button is always at `[data-id="feedback-button"]` (bottom-right).
User feedback history: `GET /my_feedback` (requires auth cookie).

## Handling "needs images" feedback
When user feedback mentions missing or needed images:
1. Use `npm run imageGen -- "descriptive prompt" --output client/assets/<name>.png` to generate the image
2. Reference the saved file in the relevant component (`/assets/<name>.png`)
3. Run `npm run build` to verify
