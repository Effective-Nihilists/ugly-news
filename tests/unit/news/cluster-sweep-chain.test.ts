import { afterEach, describe, expect, it, vi } from 'vitest';

// The sweep no longer fans out ~16 parallel queue jobs; it enqueues ONE
// `clusterSweepStep` that processes the head of a work list and re-enqueues the
// tail. These tests pin that strictly-serial chaining and its failure isolation.

const enqueued: { name: string; input: unknown }[] = [];
vi.mock('../../../server/news/queue', () => ({
  enqueueTask: async (name: string, input: unknown) => {
    enqueued.push({ name, input });
  },
}));

afterEach(() => {
  enqueued.length = 0;
  vi.restoreAllMocks();
});

async function load() {
  return import('../../../server/news/cluster-jobs');
}

describe('dispatchClusterSweepStep', () => {
  // The stub `{}` db makes the real synth/satire dispatchers throw internally
  // (db.getDoc is not a function); the step's try/catch must swallow that and
  // still advance the chain. That IS the failure-isolation contract, exercised
  // for real here rather than through a mock.

  it('drops the head and re-enqueues exactly the tail as one follow-up step', async () => {
    const mod = await load();
    await mod.dispatchClusterSweepStep({} as never, [
      { type: 'synth', clusterId: 'a' },
      { type: 'satire', clusterId: 'b' },
      { type: 'synth', clusterId: 'c' },
    ]);
    expect(enqueued).toEqual([
      {
        name: 'clusterSweepStep',
        input: { queue: [
          { type: 'satire', clusterId: 'b' },
          { type: 'synth', clusterId: 'c' },
        ] },
      },
    ]);
  });

  it('stops chaining on the last item', async () => {
    const mod = await load();
    await mod.dispatchClusterSweepStep({} as never, [
      { type: 'satire', clusterId: 'z' },
    ]);
    expect(enqueued).toEqual([]);
  });

  it('does nothing on an empty queue', async () => {
    const mod = await load();
    await mod.dispatchClusterSweepStep({} as never, []);
    expect(enqueued).toEqual([]);
  });

  it('never throws out of a failing head — a throw would make the queue re-run it forever', async () => {
    const mod = await load();
    // The head dispatch throws internally (stub db); the step must resolve, not
    // reject, and must still enqueue the tail.
    await expect(
      mod.dispatchClusterSweepStep({} as never, [
        { type: 'synth', clusterId: 'boom' },
        { type: 'satire', clusterId: 'next' },
      ]),
    ).resolves.toBeUndefined();
    expect(enqueued).toEqual([
      { name: 'clusterSweepStep', input: { queue: [{ type: 'satire', clusterId: 'next' }] } },
    ]);
  });
});
