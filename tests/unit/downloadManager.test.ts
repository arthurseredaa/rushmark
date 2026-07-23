/**
 * The background-download state machine (FR-006e).
 *
 * The real downloader and the real notifier are injected, so this runs under
 * node with neither expo-file-system nor expo-notifications present — the same
 * seam the sync-queue tests use. What is under test is the STATE: that leaving a
 * screen cannot lose a download, that a finish notifies exactly once, and that a
 * cancel is not mistaken for a failure.
 */

import {
  DownloadManager,
  type DownloadHandle,
  type DownloadProgress,
  type StartInput,
} from '@/features/downloads/downloadManager';

type Deferred = {
  handle: DownloadHandle;
  resolve: (path: string) => void;
  reject: (err: unknown) => void;
  emit: (p: DownloadProgress) => void;
  cancelled: boolean;
};

function makeManager() {
  const deferreds: Deferred[] = [];
  const notified: { videoId: string; filename: string }[] = [];
  let onProgress: (p: DownloadProgress) => void = () => {};

  const manager = new DownloadManager({
    start: (input: StartInput & { onProgress: (p: DownloadProgress) => void }) => {
      onProgress = input.onProgress;
      let resolve!: (path: string) => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const d: Deferred = {
        handle: { promise, cancel: async () => { d.cancelled = true; } },
        resolve,
        reject,
        emit: (p) => onProgress(p),
        cancelled: false,
      };
      deferreds.push(d);
      return d.handle;
    },
    notify: (item) => notified.push(item),
  });

  return { manager, deferreds, notified };
}

const INPUT: StartInput = {
  videoId: 'v1',
  folderId: 'f1',
  filename: 'clip.mp4',
  driveFileId: 'drive1',
};

/** Let queued promise callbacks run. */
const flush = () => new Promise((r) => setImmediate(r));

describe('DownloadManager', () => {
  it('registers a download as in-flight the moment it starts', () => {
    const { manager } = makeManager();
    manager.start(INPUT);
    const item = manager.get('v1');
    expect(item?.phase).toBe('downloading');
    expect(item?.fraction).toBe(0);
  });

  it('reflects progress as it arrives', () => {
    const { manager, deferreds } = makeManager();
    manager.start(INPUT);
    deferreds[0]!.emit({ fraction: 0.42 });
    expect(manager.get('v1')?.fraction).toBe(0.42);
  });

  it('marks done, records the path, and notifies exactly once on success', async () => {
    const { manager, deferreds, notified } = makeManager();
    manager.start(INPUT);
    deferreds[0]!.resolve('/cache/clip.mp4');
    await flush();

    const item = manager.get('v1');
    expect(item?.phase).toBe('done');
    expect(item?.path).toBe('/cache/clip.mp4');
    expect(notified).toEqual([{ videoId: 'v1', filename: 'clip.mp4' }]);
  });

  it('marks failed and does NOT notify on a real error', async () => {
    const { manager, deferreds, notified } = makeManager();
    manager.start(INPUT);
    deferreds[0]!.reject(new Error('network down'));
    await flush();

    const item = manager.get('v1');
    expect(item?.phase).toBe('failed');
    expect(item?.error).toBe('network down');
    expect(notified).toHaveLength(0);
  });

  it('treats a cancel as removal, not a failure', async () => {
    const { manager, deferreds } = makeManager();
    manager.start(INPUT);
    await manager.cancel('v1');
    expect(deferreds[0]!.cancelled).toBe(true);
    // The downloader rejects with a cancellation once cancel resolves.
    deferreds[0]!.reject(new Error('Download cancelled'));
    await flush();
    expect(manager.get('v1')).toBeUndefined();
  });

  it('does not start a second transfer while one is already in flight', () => {
    const { manager, deferreds } = makeManager();
    manager.start(INPUT);
    manager.start(INPUT);
    expect(deferreds).toHaveLength(1);
  });

  it('lets a finished item be dismissed, but keeps an in-flight one', async () => {
    const { manager, deferreds } = makeManager();
    manager.start(INPUT);
    manager.dismiss('v1'); // in-flight: ignored
    expect(manager.get('v1')?.phase).toBe('downloading');

    deferreds[0]!.resolve('/cache/clip.mp4');
    await flush();
    manager.dismiss('v1');
    expect(manager.get('v1')).toBeUndefined();
  });

  it('publishes every change to subscribers', () => {
    const { manager, deferreds } = makeManager();
    const seen: number[] = [];
    manager.subscribe((items) => seen.push(items.size));
    manager.start(INPUT);
    deferreds[0]!.emit({ fraction: 0.5 });
    // initial (0), after start (1), after progress (1)
    expect(seen).toEqual([0, 1, 1]);
  });
});
