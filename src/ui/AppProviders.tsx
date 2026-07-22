/**
 * The app's three ambient dependencies: the database, the signed-in user, and
 * connectivity. Everything else is passed explicitly.
 */

import type * as SQLite from 'expo-sqlite';
import * as React from 'react';

import { openDatabase } from '@/data/db/schema';
import { DriveClient } from '@/data/drive/client';
import * as connectivity from '@/data/sync/connectivity';
import {
  type AuthUser,
  getAccessToken,
  signIn as doSignIn,
  signInSilently,
  signOut as doSignOut,
} from '@/features/auth/googleAuth';

// ---------------------------------------------------------------------------

type DatabaseContextValue = { db: SQLite.SQLiteDatabase | null; ready: boolean };

const DatabaseContext = React.createContext<DatabaseContextValue>({
  db: null,
  ready: false,
});

export const useDatabase = (): SQLite.SQLiteDatabase => {
  const { db } = React.useContext(DatabaseContext);
  if (!db) throw new Error('useDatabase called before the database was ready');
  return db;
};

export const useDatabaseReady = (): boolean => React.useContext(DatabaseContext).ready;

// ---------------------------------------------------------------------------

type AuthContextValue = {
  user: AuthUser | null;
  restoring: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue>({
  user: null,
  restoring: true,
  signIn: async () => {},
  signOut: async () => {},
});

export const useAuth = (): AuthContextValue => React.useContext(AuthContext);

// ---------------------------------------------------------------------------

const ConnectivityContext = React.createContext<connectivity.Connectivity>({
  online: true,
  cellular: false,
});

export const useConnectivity = (): connectivity.Connectivity =>
  React.useContext(ConnectivityContext);

// ---------------------------------------------------------------------------

const DriveContext = React.createContext<DriveClient | null>(null);

export const useDrive = (): DriveClient => {
  const client = React.useContext(DriveContext);
  if (!client) throw new Error('useDrive called outside AppProviders');
  return client;
};

// ---------------------------------------------------------------------------

export function AppProviders({ children }: { children: React.ReactNode }): React.ReactElement {
  const [dbState, setDbState] = React.useState<DatabaseContextValue>({
    db: null,
    ready: false,
  });
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [restoring, setRestoring] = React.useState(true);
  const [net, setNet] = React.useState<connectivity.Connectivity>({
    online: true,
    cellular: false,
  });

  React.useEffect(() => {
    let cancelled = false;
    openDatabase()
      .then((db) => {
        if (!cancelled) setDbState({ db, ready: true });
      })
      .catch((err: unknown) => {
        // A database that will not open means authored work cannot be made
        // durable. Fail loudly rather than run in a state where saves evaporate.
        console.error('[rushmark] failed to open database', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    signInSilently()
      .then((restored) => {
        if (!cancelled) setUser(restored);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    connectivity.current().then(setNet).catch(() => {});
    return connectivity.subscribe(setNet);
  }, []);

  const auth = React.useMemo<AuthContextValue>(
    () => ({
      user,
      restoring,
      signIn: async () => {
        setUser(await doSignIn());
      },
      signOut: async () => {
        await doSignOut();
        setUser(null);
      },
    }),
    [user, restoring],
  );

  // The client is stable; it pulls a fresh token per request rather than
  // capturing one, so it never goes stale with the component tree.
  const drive = React.useMemo(() => new DriveClient(getAccessToken), []);

  return (
    <DatabaseContext.Provider value={dbState}>
      <AuthContext.Provider value={auth}>
        <ConnectivityContext.Provider value={net}>
          <DriveContext.Provider value={drive}>{children}</DriveContext.Provider>
        </ConnectivityContext.Provider>
      </AuthContext.Provider>
    </DatabaseContext.Provider>
  );
}
