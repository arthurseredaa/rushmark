/**
 * Background download registry (FR-006e).
 *
 * The download itself already survives navigation — its promise lives in the JS
 * runtime, not on the screen that started it. What did NOT survive was the
 * *state*: progress and completion were React state on the video screen, so
 * leaving the screen lost the progress bar and the "it's ready" transition, and
 * nothing ever told the user their clip had arrived.
 *
 * This manager owns that state at the root instead, so a download started on the
 * video screen keeps reporting while the user browses elsewhere, and fires a
 * notification when it lands. It is deliberately free of React and of
 * expo-notifications — both the downloader and the notifier are injected — so the
 * state machine is testable under node, where neither native module exists.
 *
 * Scope (the decision on 2026-07-23): IN-APP background. The download runs as
 * long as the app is alive; a full quit stops it. True OS-background would need a
 * native background URLSession, which is a separate, larger piece of work.
 */

export type DownloadPhase = 'downloading' | 'done' | 'failed';

export type DownloadItem = {
  readonly videoId: string;
  readonly filename: string;
  /** 0..1, or null when Drive did not report a total length. */
  readonly fraction: number | null;
  readonly phase: DownloadPhase;
  /** Set once the file is on disk (phase 'done'). */
  readonly path?: string;
  /** Set on 'failed'. */
  readonly error?: string;
};

export type StartInput = {
  videoId: string;
  folderId: string;
  filename: string;
  driveFileId: string;
};

export type DownloadProgress = { fraction: number | null };

export type DownloadHandle = {
  promise: Promise<string>;
  cancel: () => Promise<void>;
};

export type DownloadManagerDeps = {
  /** Kick off the actual transfer (bound to the database in the host). */
  start: (
    input: StartInput & { onProgress: (p: DownloadProgress) => void },
  ) => DownloadHandle;
  /** Tell the user a download finished. No-op in tests. */
  notify: (item: { videoId: string; filename: string }) => void;
};

type Listener = (items: ReadonlyMap<string, DownloadItem>) => void;

export class DownloadManager {
  private readonly items = new Map<string, DownloadItem>();
  private readonly handles = new Map<string, DownloadHandle>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly deps: DownloadManagerDeps) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ReadonlyMap<string, DownloadItem> {
    return new Map(this.items);
  }

  get(videoId: string): DownloadItem | undefined {
    return this.items.get(videoId);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  private set(videoId: string, patch: Partial<DownloadItem>): void {
    const current = this.items.get(videoId);
    if (!current) return;
    this.items.set(videoId, { ...current, ...patch });
    this.emit();
  }

  /**
   * Begin (or resume attention to) a download.
   *
   * Idempotent while one is in flight: a second tap on a video already
   * downloading returns without starting a duplicate transfer.
   */
  start(input: StartInput): void {
    const existing = this.items.get(input.videoId);
    if (existing && existing.phase === 'downloading') return;

    this.items.set(input.videoId, {
      videoId: input.videoId,
      filename: input.filename,
      fraction: 0,
      phase: 'downloading',
    });
    this.emit();

    const handle = this.deps.start({
      ...input,
      onProgress: (p) => this.set(input.videoId, { fraction: p.fraction }),
    });
    this.handles.set(input.videoId, handle);

    handle.promise
      .then((path) => {
        this.handles.delete(input.videoId);
        this.set(input.videoId, { phase: 'done', fraction: 1, path });
        this.deps.notify({ videoId: input.videoId, filename: input.filename });
      })
      .catch((err: unknown) => {
        this.handles.delete(input.videoId);
        const message = err instanceof Error ? err.message : String(err);
        // A cancel is a user action, not a failure: drop it silently rather than
        // leaving a scary error card behind.
        if (/cancelled/i.test(message)) {
          this.items.delete(input.videoId);
          this.emit();
          return;
        }
        this.set(input.videoId, { phase: 'failed', fraction: null, error: message });
      });
  }

  async cancel(videoId: string): Promise<void> {
    const handle = this.handles.get(videoId);
    await handle?.cancel();
    // The promise's cancel branch removes the item; if there was no live handle
    // (already done/failed), clear it here so the UI can dismiss it.
    if (!handle && this.items.has(videoId)) {
      this.items.delete(videoId);
      this.emit();
    }
  }

  /** Forget a finished (done/failed) item once the UI has reacted to it. */
  dismiss(videoId: string): void {
    const item = this.items.get(videoId);
    if (!item || item.phase === 'downloading') return;
    this.items.delete(videoId);
    this.emit();
  }
}
