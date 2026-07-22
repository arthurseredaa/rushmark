/**
 * Google Drive v3 REST client. See contracts/drive-api.md.
 *
 * Called directly over fetch — no googleapis SDK (D-plan: Node-oriented, heavy,
 * and unnecessary for six endpoints).
 */

export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Why a failure happened, in the only terms the app acts on.
 *
 * `offline` is the load-bearing one. It is NOT an error in the sense that
 * matters: a save made offline is a save that queues and publishes later
 * (Principle II, FR-038). Collapsing it into a generic failure is how "never
 * lose authored work" quietly becomes "usually don't".
 */
export type DriveErrorKind =
  | 'offline'
  | 'auth'
  | 'not-found'
  | 'permission'
  | 'rate-limit'
  | 'server'
  | 'unknown';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }

  /** Worth trying again later without the user doing anything. */
  get isRetryable(): boolean {
    return (
      this.kind === 'offline' || this.kind === 'rate-limit' || this.kind === 'server'
    );
  }
}

/**
 * A fetch failure with no HTTP status is a network fault, not a server verdict.
 * The distinction matters: this is what routes a save into the queue instead of
 * in front of the user as a failure they must act on.
 */
const asOffline = (err: unknown): DriveError =>
  new DriveError(
    'offline',
    err instanceof Error ? err.message : 'Network request failed',
  );

function classify(status: number, body: string): DriveError {
  switch (true) {
    case status === 401:
      return new DriveError('auth', 'Google sign-in has expired.', status);
    case status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(body):
      return new DriveError('rate-limit', 'Drive rate limit reached.', status);
    case status === 403:
      return new DriveError('permission', 'Drive denied access to this file.', status);
    case status === 404:
      return new DriveError('not-found', 'The file no longer exists in Drive.', status);
    case status === 429:
      return new DriveError('rate-limit', 'Drive rate limit reached.', status);
    case status >= 500:
      return new DriveError('server', `Drive server error (${status}).`, status);
    default:
      return new DriveError('unknown', `Drive request failed (${status}): ${body}`, status);
  }
}

export type TokenProvider = () => Promise<string>;

export type RequestOptions = {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  baseUrl?: string;
  signal?: AbortSignal;
};

export class DriveClient {
  constructor(private readonly getToken: TokenProvider) {}

  private buildUrl(path: string, options: RequestOptions): string {
    const base = options.baseUrl ?? DRIVE_API;
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /** Raw request with auth, classification, and one retry on a stale token. */
  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = this.buildUrl(path, options);

    const send = async (token: string): Promise<Response> => {
      try {
        return await fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(options.headers ?? {}),
          },
          body: options.body ?? null,
          signal: options.signal ?? null,
        });
      } catch (err) {
        throw asOffline(err);
      }
    };

    let response = await send(await this.getToken());

    if (response.status === 401) {
      // One retry with a fresh token: an expired access token is routine and
      // should never surface to the user as a failed save.
      response = await send(await this.getToken());
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw classify(response.status, body);
    }

    return response;
  }

  async getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(path, options);
    return (await response.json()) as T;
  }

  async getText(path: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.request(path, options);
    return response.text();
  }
}

/**
 * Retry with exponential backoff, for the errors that deserve it.
 *
 * Deliberately does not swallow anything: a non-retryable error propagates on
 * the first attempt, and a retryable one still propagates once the attempts run
 * out. The caller decides what to do — and for a pending save, that means
 * staying queued, never being dropped.
 */
export async function withBackoff<T>(
  operation: () => Promise<T>,
  { attempts = 3, baseDelayMs = 500 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof DriveError && err.isRetryable;
      if (!retryable || attempt === attempts - 1) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
