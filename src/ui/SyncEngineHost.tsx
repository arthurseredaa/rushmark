/**
 * Owns the SyncEngine's lifetime and publishes its status to the tree.
 *
 * Mounted once at the root so the queue keeps draining as the user navigates —
 * a save queued on the video screen must still publish after they have moved
 * back to the folder list (FR-035).
 */

import * as React from 'react';

import { SyncEngine, type SyncStatus } from '@/data/sync/syncEngine';

import { useDatabaseReady, useDatabase, useDrive } from './AppProviders';

const IDLE: SyncStatus = { running: false, pending: 0, lastResult: null, lastError: null };

type SyncContextValue = {
  status: SyncStatus;
  /** Drain now — for a manual "retry" affordance (FR-040). */
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
};

const SyncContext = React.createContext<SyncContextValue>({
  status: IDLE,
  retry: async () => {},
  refresh: async () => {},
});

export const useSync = (): SyncContextValue => React.useContext(SyncContext);

export function SyncEngineHost({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const ready = useDatabaseReady();
  // Until the database is open there is no queue to drain. Render children with
  // the idle default rather than blocking the whole tree on it.
  return ready ? <Host>{children}</Host> : <>{children}</>;
}

function Host({ children }: { children: React.ReactNode }): React.ReactElement {
  const db = useDatabase();
  const drive = useDrive();
  const [status, setStatus] = React.useState<SyncStatus>(IDLE);
  const engineRef = React.useRef<SyncEngine | null>(null);

  React.useEffect(() => {
    const engine = new SyncEngine(db, drive);
    engineRef.current = engine;
    const unsubscribe = engine.subscribe(setStatus);
    engine.start();
    return () => {
      unsubscribe();
      engine.stop();
      engineRef.current = null;
    };
  }, [db, drive]);

  const value = React.useMemo<SyncContextValue>(
    () => ({
      status,
      retry: async () => {
        await engineRef.current?.drain();
      },
      refresh: async () => {
        await engineRef.current?.refreshPendingCount();
      },
    }),
    [status],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
