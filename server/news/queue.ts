import { getAdapter } from 'ugly-app/server';
import type { cronTasks } from '../../shared/cron';

// Names of the queue-only (fan-out) workers.
type WorkerName = keyof typeof cronTasks;

/**
 * Enqueue a background worker job. On Node this runs inline (dev parity); on
 * Cloudflare Workers it sends to the QUEUE producer binding, processed by the
 * Worker's queue() handler. Replaces ugly.bot's `enqueueTask`.
 */
export async function enqueueTask(
  name: WorkerName,
  input: unknown,
): Promise<void> {
  await getAdapter().schedule.enqueueWorker(name, input);
}
