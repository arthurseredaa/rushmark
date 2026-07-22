/**
 * Google Sign-In and Drive access tokens.
 *
 * Scope is FULL drive (`https://www.googleapis.com/auth/drive`), not
 * `drive.file`. This is not over-reach: `drive.file` can only see files the app
 * itself created, and the entire premise is authoring metadata for footage the
 * user shot and uploaded some other way (FR-003). `drive.file` cannot see it.
 *
 * The consequence — a scary consent screen, and Google verification if this were
 * ever published — is accepted in the spec for a personal app.
 */

import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  photo: string | null;
};

let configured = false;

export function configure(): void {
  if (configured) return;

  const extra = Constants.expoConfig?.extra ?? {};
  const iosClientId = extra.googleIosClientId as string | undefined;
  const webClientId = extra.googleWebClientId as string | undefined;

  if (!iosClientId) {
    throw new Error(
      'GOOGLE_IOS_CLIENT_ID is not set. Copy .env.example to .env and fill it in.',
    );
  }

  GoogleSignin.configure({
    iosClientId,
    webClientId,
    scopes: [DRIVE_SCOPE],
    offlineAccess: false, // no backend — there is nothing to exchange a code with
  });

  configured = true;
}

export class AuthError extends Error {
  constructor(
    readonly kind: 'cancelled' | 'in-progress' | 'scope-denied' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function signIn(): Promise<AuthUser> {
  configure();
  try {
    const response = await GoogleSignin.signIn();

    if (response.type === 'cancelled') {
      throw new AuthError('cancelled', 'Sign-in was cancelled.');
    }

    const user = response.data.user;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      photo: user.photo,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (isErrorWithCode(err)) {
      switch (err.code) {
        case statusCodes.SIGN_IN_CANCELLED:
          throw new AuthError('cancelled', 'Sign-in was cancelled.');
        case statusCodes.IN_PROGRESS:
          throw new AuthError('in-progress', 'Sign-in is already in progress.');
        default:
          throw new AuthError('unknown', err.message);
      }
    }
    throw new AuthError('unknown', err instanceof Error ? err.message : String(err));
  }
}

/** Restore a previous session without showing UI. */
export async function signInSilently(): Promise<AuthUser | null> {
  configure();
  try {
    const response = await GoogleSignin.signInSilently();
    if (response.type === 'noSavedCredentialFound') return null;
    const user = response.data.user;
    return { id: user.id, email: user.email, name: user.name, photo: user.photo };
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  configure();
  await GoogleSignin.signOut();
}

/**
 * A Drive access token, refreshed as needed.
 *
 * This is the TokenProvider handed to DriveClient. `getTokens()` refreshes an
 * expired token transparently, which is why a 401 retry in the client is enough
 * to make token expiry invisible to the user.
 */
export async function getAccessToken(): Promise<string> {
  configure();
  const tokens = await GoogleSignin.getTokens();
  return tokens.accessToken;
}

/**
 * Whether the Drive scope was actually granted.
 *
 * The user can untick it on the consent screen. If they do, everything looks
 * signed in and every Drive call fails with a permission error — so check
 * explicitly rather than discovering it later.
 */
export async function hasDriveScope(): Promise<boolean> {
  configure();
  const user = await GoogleSignin.getCurrentUser();
  return user?.scopes?.includes(DRIVE_SCOPE) ?? false;
}
