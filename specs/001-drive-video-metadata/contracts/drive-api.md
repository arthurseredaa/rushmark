# Contract: Google Drive v3 REST surface

**Status**: Stable — verified against current Drive API docs (D6).
**Auth**: Bearer access token from `@react-native-google-signin/google-signin` `getTokens()` (D5).
**Scope**: `https://www.googleapis.com/auth/drive` (full) — required by FR-003 to read pre-existing videos and write beside them. `drive.file` cannot see footage the app didn't upload.

Six operations. Called directly over `fetch` — no `googleapis` SDK (D6).

---

## 1. List videos in a folder — FR-004

```http
GET https://www.googleapis.com/drive/v3/files
  ?q='{folderId}' in parents and mimeType contains 'video/' and trashed=false
  &fields=nextPageToken,files(id,name,mimeType,size,thumbnailLink,modifiedTime)
  &pageSize=100
```

- `q` scopes to direct children only — matches "does not recurse into subfolders" (spec assumption).
- `thumbnailLink` gives FR-004's thumbnails without downloading video.
- `size` feeds the cellular-confirmation prompt (FR-006a).
- Paginate via `nextPageToken` — folders can hold hundreds of clips.
- Thumbnail URLs are short-lived and need the auth header; they're re-fetched with the listing, not persisted long-term.

## 2. Find a video's sidecars — FR-021

```http
GET https://www.googleapis.com/drive/v3/files
  ?q='{folderId}' in parents and name='{filename}.json' and trashed=false
  &fields=files(id,name,modifiedTime)
```

Looked up **by name**, not by ID — the filename is the identity (FR-021a). Same query for `.csv`/`.otio` when overwriting.

⚠️ Escape single quotes in `name` as `\'` — a filename containing an apostrophe (`Bob's take.mp4`) otherwise breaks the query. Easy to miss; will happen with real footage.

## 3. Download media — FR-006

```http
GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
```

- Videos: `expo-file-system` `createDownloadResumable` → progress + cancel (FR-006b), writing to `.partial` and moving into place only on completion, so a partial is never mistaken for a cached copy.
- Sidecars: plain `fetch`, they're kilobytes.

## 4. Create a sidecar — FR-025

```http
POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
Content-Type: multipart/related; boundary=...

{"name": "A001_C001.mp4.json", "parents": ["{folderId}"]}
--boundary
Content-Type: application/json
<file content>
```

Multipart (metadata + content in one request) — sidecars are small, so resumable upload is unnecessary. Each upload is atomic: the file appears complete or not at all.

## 5. Update an existing sidecar — FR-027

```http
PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=media
Content-Type: application/json
<file content>
```

Updates content in place — last write wins (FR-027), no duplicate files. Requires the lookup in (2) first: if a sidecar exists → PATCH, else → POST.

## 6. Delete sidecars — FR-029a

```http
DELETE https://www.googleapis.com/drive/v3/files/{fileId}
```

For clear-and-save. All three files, or none (the queue retries until complete).

---

## Error mapping

| HTTP | Meaning | App behavior |
|---|---|---|
| 401 | Token expired | Refresh via google-signin, retry once. Not user-visible. |
| 403 `insufficientPermissions` | Scope revoked | Prompt re-consent (FR-003) |
| 403 `userRateLimitExceeded` | Throttled | Exponential backoff; save **stays pending** (FR-038) |
| 404 | File/folder gone | Report unavailable (spec edge case). Don't discard the pending save — the user may restore it. |
| 5xx | Drive down | Backoff, stay pending |
| Network unreachable | Offline | **Not an error** — queue and move on (FR-034) |

**Offline is the normal path, not a failure.** The client must distinguish "no connectivity" (queue silently, no alarm) from "Drive said no" (surface with cause). Conflating them either nags the user on a plane or hides a real permission problem.

## Atomicity — the honest limit (D9)

Drive has **no multi-file transaction**. Individual uploads are atomic, so a *truncated* sidecar is impossible — FR-028's real requirement holds absolutely.

The residual exposure is set-level: `.csv`/`.otio` updated, app dies, `.json` not yet written. Mitigated by ordering (projections first, canonical last — a stale projection beside an old canonical is a consistent old state) and by the queue retrying until all three land. Window is seconds, single-user, self-healing. Stated plainly rather than claimed as a guarantee the platform can't provide.

## Not used

- **Changes API / webhooks** — no external writers to detect; last write wins (FR-027).
- **Resumable upload** — sidecars are kilobytes.
- **App Data folder** — sidecars must be user-visible next to the footage.
- **Revisions** — no version history in v1.
