/* eslint-disable import/first --
 * jest.mock factories cannot reference variables declared after them, so the
 * mocked modules must be imported below their mocks. This is the standard shape
 * for this pattern, not an ordering slip. */

/**
 * The offline queue and its drain-on-reconnect (T057, T058). US3.
 *
 * Constitution Principle II: "A pending save MUST leave the queue only by
 * success or by explicit user discard. Failure keeps it queued with the cause
 * recorded and surfaced. There is no path from pending to dropped."
 *
 * Every test below is a way that sentence could be violated.
 */

import { FakeStore, makeRepoMocks } from './fakeDb';

const store = new FakeStore();
const repos = makeRepoMocks(store);

jest.mock('@/data/db/repositories', () => repos);

const publishSidecars = jest.fn();
const deleteSidecars = jest.fn();
jest.mock('@/data/drive/sidecars', () => ({
  publishSidecars: (...args: unknown[]) => publishSidecars(...args),
  deleteSidecars: (...args: unknown[]) => deleteSidecars(...args),
}));

let online = true;
let reconnectListener: (() => void) | null = null;
jest.mock('@/data/sync/connectivity', () => ({
  current: async () => ({ online, cellular: false }),
  subscribe: () => () => {},
  onReconnect: (listener: () => void) => {
    reconnectListener = listener;
    return () => {
      reconnectListener = null;
    };
  },
}));

import { DriveError } from '@/data/drive/client';
import { SyncEngine } from '@/data/sync/syncEngine';
import type { Canonical } from '@/domain/canonical';

const fakeDb = {} as never;
const fakeClient = {} as never;

const canonical = { identity: { filename: 'a.mp4' } } as unknown as Canonical;

beforeEach(() => {
  store.videos.clear();
  store.pending.clear();
  store.syncStates.clear();
  jest.clearAllMocks();
  online = true;
  publishSidecars.mockResolvedValue(undefined);
  deleteSidecars.mockResolvedValue(undefined);
});

describe('draining the queue', () => {
  it('publishes a queued save and removes it from the queue', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'upsert', canonical);

    const engine = new SyncEngine(fakeDb, fakeClient);
    const result = await engine.drain();

    expect(publishSidecars).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 1, published: 1, failed: 0 });
    expect(store.pending.size).toBe(0);
    expect(store.syncStates.get('v1')).toBe('published');
  });

  it('publishes exactly once — a drained save is not republished', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'upsert', canonical);

    const engine = new SyncEngine(fakeDb, fakeClient);
    await engine.drain();
    await engine.drain();

    expect(publishSidecars).toHaveBeenCalledTimes(1);
  });

  it('publishes what the user confirmed, not whatever is current now', async () => {
    store.addVideo({ id: 'v1' });
    const confirmed = {
      identity: { filename: 'a.mp4' },
      authored: { comments: 'what they typed on the plane' },
    } as unknown as Canonical;
    store.enqueue('v1', 'upsert', confirmed);

    await new SyncEngine(fakeDb, fakeClient).drain();

    expect(publishSidecars).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ canonical: confirmed }),
    );
  });

  it('handles a queued delete (clear-and-save made offline)', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'delete', null);

    await new SyncEngine(fakeDb, fakeClient).drain();

    expect(deleteSidecars).toHaveBeenCalledTimes(1);
    expect(publishSidecars).not.toHaveBeenCalled();
    expect(store.pending.size).toBe(0);
  });

  it('drains several saves independently', async () => {
    for (const id of ['v1', 'v2', 'v3']) {
      store.addVideo({ id });
      store.enqueue(id, 'upsert', canonical);
    }

    const result = await new SyncEngine(fakeDb, fakeClient).drain();

    expect(result.published).toBe(3);
    expect(store.pending.size).toBe(0);
  });
});

describe('failure never drops a save [Principle II]', () => {
  it('KEEPS the save queued when Drive refuses, and records why', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'upsert', canonical);
    publishSidecars.mockRejectedValue(
      new DriveError('permission', 'Drive denied access to this file.', 403),
    );

    const result = await new SyncEngine(fakeDb, fakeClient).drain();

    expect(result).toEqual({ attempted: 1, published: 0, failed: 1 });
    // The row is STILL THERE. This is the whole principle.
    expect(store.pending.size).toBe(1);
    expect(store.pending.get('v1')?.lastError).toMatch(/denied access/);
    expect(store.pending.get('v1')?.attempts).toBe(1);
    expect(store.syncStates.get('v1')).toBe('failed');
  });

  it('keeps it queued across repeated failures, counting attempts', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'upsert', canonical);
    publishSidecars.mockRejectedValue(new DriveError('server', 'Drive server error (500).', 500));

    const engine = new SyncEngine(fakeDb, fakeClient);
    await engine.drain();
    await engine.drain();
    await engine.drain();

    // Three failures. Still queued. There is no attempt limit that discards.
    expect(store.pending.size).toBe(1);
    expect(store.pending.get('v1')?.attempts).toBe(3);
  });

  it('eventually publishes once the failure clears', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'upsert', canonical);
    publishSidecars.mockRejectedValueOnce(new DriveError('server', 'boom', 500));

    const engine = new SyncEngine(fakeDb, fakeClient);
    await engine.drain();
    expect(store.pending.size).toBe(1);

    await engine.drain();
    expect(store.pending.size).toBe(0);
    expect(store.syncStates.get('v1')).toBe('published');
  });

  it('one failing save does not block the others', async () => {
    for (const id of ['v1', 'v2', 'v3']) {
      store.addVideo({ id });
      store.enqueue(id, 'upsert', canonical);
    }
    publishSidecars
      .mockRejectedValueOnce(new DriveError('permission', 'nope', 403))
      .mockResolvedValue(undefined);

    const result = await new SyncEngine(fakeDb, fakeClient).drain();

    expect(result.published).toBe(2);
    expect(result.failed).toBe(1);
    expect(store.pending.size).toBe(1);
  });

  it('keeps a save queued when the video row is missing rather than dropping it', async () => {
    // No addVideo — the library forgot this video somehow.
    store.enqueue('ghost', 'upsert', canonical);

    await new SyncEngine(fakeDb, fakeClient).drain();

    expect(store.pending.size).toBe(1);
    expect(store.pending.get('ghost')?.lastError).toMatch(/no longer in the library/);
  });
});

describe('offline is not a failure', () => {
  it('stays pending (not failed) when the network drops mid-drain', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'upsert', canonical);
    publishSidecars.mockRejectedValue(new DriveError('offline', 'Network request failed'));

    await new SyncEngine(fakeDb, fakeClient).drain();

    expect(store.pending.size).toBe(1);
    // 'pending', not 'failed' — the user has nothing to fix.
    expect(store.syncStates.get('v1')).toBe('pending');
  });

  it('stops draining once offline instead of hammering every row', async () => {
    for (const id of ['v1', 'v2', 'v3']) {
      store.addVideo({ id });
      store.enqueue(id, 'upsert', canonical);
    }
    publishSidecars.mockRejectedValue(new DriveError('offline', 'Network request failed'));

    await new SyncEngine(fakeDb, fakeClient).drain();

    expect(publishSidecars).toHaveBeenCalledTimes(1);
    expect(store.pending.size).toBe(3);
  });
});

describe('reconnect triggers a drain (FR-035)', () => {
  it('publishes automatically on reconnect, without asking again', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'upsert', canonical);

    online = false;
    const engine = new SyncEngine(fakeDb, fakeClient);
    engine.start();
    await Promise.resolve();

    expect(publishSidecars).not.toHaveBeenCalled();

    // The plane lands.
    online = true;
    reconnectListener?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publishSidecars).toHaveBeenCalledTimes(1);
    expect(store.pending.size).toBe(0);
    engine.stop();
  });

  it('drains on start when already online', async () => {
    store.addVideo({ id: 'v1' });
    store.enqueue('v1', 'upsert', canonical);

    const engine = new SyncEngine(fakeDb, fakeClient);
    engine.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publishSidecars).toHaveBeenCalled();
    engine.stop();
  });
});
