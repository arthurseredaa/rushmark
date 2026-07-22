/**
 * The six Drive operations the app depends on. See contracts/drive-api.md.
 */

import { DRIVE_UPLOAD_API, DriveClient, DriveError } from './client';

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  modifiedTime?: string;
};

type FileList = { files: DriveFile[]; nextPageToken?: string };

/**
 * Escape a value for a Drive `q` query string literal.
 *
 * Drive's query language delimits strings with single quotes, so a filename
 * containing an apostrophe ("Bob's take.mp4") terminates the literal early and
 * produces a syntax error — or worse, a query that means something else. This
 * will happen with real footage, and the failure would look like "the file
 * doesn't exist" rather than "your quoting is broken".
 */
export const escapeQueryValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** 1. List a folder's videos (FR-004). Paginates — folders hold hundreds. */
export async function listVideos(
  client: DriveClient,
  folderId: string,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const page: FileList = await client.getJson<FileList>('/files', {
      query: {
        q: `'${escapeQueryValue(folderId)}' in parents and mimeType contains 'video/' and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,thumbnailLink,modifiedTime)',
        pageSize: 100,
        pageToken,
        orderBy: 'name_natural',
      },
    });
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files;
}

/** List a user's folders, for the picker (FR-001). */
export async function listFolders(
  client: DriveClient,
  parentId = 'root',
): Promise<DriveFile[]> {
  const page = await client.getJson<FileList>('/files', {
    query: {
      q: `'${escapeQueryValue(parentId)}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime)',
      pageSize: 100,
      orderBy: 'name_natural',
    },
  });
  return page.files ?? [];
}

export async function getFolder(client: DriveClient, folderId: string): Promise<DriveFile> {
  return client.getJson<DriveFile>(`/files/${encodeURIComponent(folderId)}`, {
    query: { fields: 'id,name,mimeType' },
  });
}

/** 2. Find a file by name in a folder (FR-021). Filename is the identity (FR-021a). */
export async function findByName(
  client: DriveClient,
  folderId: string,
  name: string,
): Promise<DriveFile | null> {
  const page = await client.getJson<FileList>('/files', {
    query: {
      q: `'${escapeQueryValue(folderId)}' in parents and name='${escapeQueryValue(name)}' and trashed=false`,
      fields: 'files(id,name,modifiedTime)',
    },
  });
  return page.files?.[0] ?? null;
}

/** 3. Download a small file's text (sidecars are kilobytes). */
export async function downloadText(client: DriveClient, fileId: string): Promise<string> {
  return client.getText(`/files/${encodeURIComponent(fileId)}`, {
    query: { alt: 'media' },
  });
}

/** The URL a resumable video download targets. Videos go via expo-file-system. */
export const mediaUrl = (fileId: string): string =>
  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;

const MULTIPART_BOUNDARY = 'rushmark-boundary-9f2c1a';

/** 4. Create a file with content in one atomic multipart request (FR-025). */
export async function createFile(
  client: DriveClient,
  input: { name: string; folderId: string; content: string; mimeType: string },
): Promise<DriveFile> {
  const metadata = JSON.stringify({ name: input.name, parents: [input.folderId] });

  const body =
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Type: ${input.mimeType}\r\n\r\n` +
    `${input.content}\r\n` +
    `--${MULTIPART_BOUNDARY}--`;

  const response = await client.request('/files', {
    method: 'POST',
    baseUrl: DRIVE_UPLOAD_API,
    query: { uploadType: 'multipart', fields: 'id,name' },
    headers: { 'Content-Type': `multipart/related; boundary=${MULTIPART_BOUNDARY}` },
    body,
  });
  return (await response.json()) as DriveFile;
}

/** 5. Replace an existing file's content in place — last write wins (FR-027). */
export async function updateFileContent(
  client: DriveClient,
  input: { fileId: string; content: string; mimeType: string },
): Promise<DriveFile> {
  const response = await client.request(`/files/${encodeURIComponent(input.fileId)}`, {
    method: 'PATCH',
    baseUrl: DRIVE_UPLOAD_API,
    query: { uploadType: 'media', fields: 'id,name' },
    headers: { 'Content-Type': input.mimeType },
    body: input.content,
  });
  return (await response.json()) as DriveFile;
}

/** 6. Delete a file (FR-029a, clear-and-save). */
export async function deleteFile(client: DriveClient, fileId: string): Promise<void> {
  try {
    await client.request(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  } catch (err) {
    // Already gone is the outcome we wanted. Anything else is real.
    if (err instanceof DriveError && err.kind === 'not-found') return;
    throw err;
  }
}

/**
 * Write a file by name: PATCH if it exists, POST if it does not.
 *
 * The lookup-then-write is what keeps last-write-wins from becoming
 * accumulate-duplicates.
 */
export async function upsertByName(
  client: DriveClient,
  input: { folderId: string; name: string; content: string; mimeType: string },
): Promise<DriveFile> {
  const existing = await findByName(client, input.folderId, input.name);
  if (existing) {
    return updateFileContent(client, {
      fileId: existing.id,
      content: input.content,
      mimeType: input.mimeType,
    });
  }
  return createFile(client, input);
}
