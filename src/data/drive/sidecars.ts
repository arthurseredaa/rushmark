/**
 * Read, write, and delete a video's sidecar set.
 *
 * See contracts/drive-api.md "Atomicity — the honest limit (D9)".
 */

import type { Canonical } from '@/domain/canonical';
import { serializeCanonical } from '@/domain/canonical';
import { buildCsv } from '@/domain/projections/csv';
import { buildOtio, serializeOtio } from '@/domain/projections/otio';

import type { DriveClient } from './client';
import { DriveError } from './client';
import { deleteFile, downloadText, findByName, upsertByName } from './files';

/** The sidecar prefix is the FULL video filename, so clip.mp4 and clip.mov cannot collide. */
export const sidecarNames = (filename: string) => ({
  json: `${filename}.json`,
  csv: `${filename}.csv`,
  otio: `${filename}.otio`,
});

const MIME = {
  json: 'application/json',
  csv: 'text/csv',
  otio: 'application/json',
} as const;

/**
 * Publish all three sidecars.
 *
 * ORDER IS LOAD-BEARING: projections first, canonical LAST.
 *
 * Drive offers no multi-file transaction (D9), so if the app dies mid-publish
 * the set can briefly disagree. Writing the canonical last means the survivable
 * intermediate state is "new projections beside an OLD canonical" — which reads
 * as a consistent older state, because the canonical is the only authority
 * (Principle III) and the projections are regenerable from it. Writing the
 * canonical first would instead leave a NEW canonical beside STALE projections,
 * which is a state that lies about itself.
 *
 * Each individual upload is atomic, so a truncated sidecar is impossible —
 * which is what FR-028 actually requires.
 */
export async function publishSidecars(
  client: DriveClient,
  input: { folderId: string; filename: string; canonical: Canonical },
): Promise<void> {
  const names = sidecarNames(input.filename);

  const csv = buildCsv(input.canonical);
  const otio = serializeOtio(buildOtio(input.canonical));
  const json = serializeCanonical(input.canonical);

  await upsertByName(client, {
    folderId: input.folderId,
    name: names.csv,
    content: csv,
    mimeType: MIME.csv,
  });

  await upsertByName(client, {
    folderId: input.folderId,
    name: names.otio,
    content: otio,
    mimeType: MIME.otio,
  });

  // Canonical last. See above.
  await upsertByName(client, {
    folderId: input.folderId,
    name: names.json,
    content: json,
    mimeType: MIME.json,
  });
}

/**
 * Read the canonical sidecar's raw text, or null when there isn't one.
 *
 * Only the .json is ever read. The .csv and .otio are projections and are never
 * a source of truth (Principle III) — reading one back would forfeit the ability
 * to change editors without touching the model.
 */
export async function readCanonicalText(
  client: DriveClient,
  input: { folderId: string; filename: string },
): Promise<string | null> {
  const names = sidecarNames(input.filename);
  const file = await findByName(client, input.folderId, names.json);
  if (!file) return null;

  try {
    return await downloadText(client, file.id);
  } catch (err) {
    if (err instanceof DriveError && err.kind === 'not-found') return null;
    throw err;
  }
}

/** Does this video already have a published canonical? Drives the list badge (FR-003). */
export async function hasSidecars(
  client: DriveClient,
  input: { folderId: string; filename: string },
): Promise<boolean> {
  const file = await findByName(client, input.folderId, sidecarNames(input.filename).json);
  return file !== null;
}

/**
 * Delete all three sidecars — clear-and-save (FR-029a).
 *
 * Canonical FIRST here, inverting the publish order for the same reason: once
 * the canonical is gone the video reads as unauthored, and leftover projections
 * are orphans rather than a claim about current state. The queue retries until
 * all three are gone.
 */
export async function deleteSidecars(
  client: DriveClient,
  input: { folderId: string; filename: string },
): Promise<void> {
  const names = sidecarNames(input.filename);

  for (const name of [names.json, names.csv, names.otio]) {
    const file = await findByName(client, input.folderId, name);
    if (file) await deleteFile(client, file.id);
  }
}
