// Worker-safe perf indirection.
//
// cluster.ts runs in BOTH the Node dev entry AND the Cloudflare Workers bundle.
// Importing `recordPerf` from `ugly-app/server` directly drags Node http agents
// (agent-base → http/https/net) into the Workers bundle and breaks
// `build:workers` with ~200 "Could not resolve" errors. So instead of a static
// barrel import, worker-bundled code records perf through this sink, and each
// runtime entry injects an appropriate recorder:
//   • Node entry (server/index.ts) → the real `recordPerf` (buffered → flushed
//     to the perfLog store, queryable via `ugly-app perf:dev`).
//   • Workers entry (server/workers.ts) → leaves it a no-op; the worker-side
//     calibration signal is the `[cluster-sim]` console line (visible via
//     `wrangler tail` / Logpush), because the framework exposes no Workers-safe
//     perf API in this version.
//
// This keeps the Workers bundle free of the Node-only logging barrel while still
// recording queryable perf where the API actually works.

type PerfSink = (operation: string, durationMs: number) => void;

let perfSink: PerfSink | null = null;

/** Wire the concrete perf recorder (call once at startup from a runtime entry). */
export function setPerfSink(sink: PerfSink): void {
  perfSink = sink;
}

/** Record a perf sample through the injected sink. No-op until a sink is set;
 *  never throws (telemetry must not break the pipeline). */
export function recordPerfSample(operation: string, durationMs: number): void {
  try {
    perfSink?.(operation, durationMs);
  } catch {
    /* ignore — telemetry is best-effort */
  }
}
