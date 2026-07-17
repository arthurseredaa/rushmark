# Feature Specification: Drive Video Metadata Producer

**Feature Branch**: `001-drive-video-metadata`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "Drive Video Metadata Producer (iOS) — PRD. A personal iOS app that connects to a Google Drive folder of videos, previews them frame-accurately, and lets the user author metadata written back next to each video in Drive as sidecar files (canonical `.json` plus editor-ready `.csv` and `.otio`). The app also reads existing sidecars so a video can be reopened and edited."

## Clarifications

### Session 2026-07-16

- Q: What binds a sidecar to its video — the filename or the Drive file ID? → A: Filename only. A rename in Drive orphans the existing sidecars.
- Q: What does the app do with variable frame rate footage, where frame spacing isn't constant? → A: Degrade to whole-video only — the video plays, comments and keywords work, marker authoring is disabled. Expected to be rare: the user shoots 24 and 60 fps constant-rate.
- Q: What happens when a sidecar's schema version doesn't match the app's? → A: Read leniently — load every recognized field, ignore the rest, show a small warning. Sidecars are only ever written by the app UI, never hand-edited in Drive, so strict version gating is unnecessary. Unrecognized fields are preserved verbatim on save so a partial read cannot destroy them.
- Q: Can a user remove a video's metadata entirely? → A: Yes, by clearing it — saving a video whose comments, keywords, and markers are all empty deletes its sidecars from Drive rather than writing empty ones. No separate delete command.
- Q: What happens when a large original is opened away from Wi-Fi? → A: Download immediately on Wi-Fi; on cellular, show the file size and ask first. Downloads show progress and can be cancelled.
- Q: Must the app work offline? → A: Yes — offline authoring is a core requirement, not an edge case. With videos already cached, the user can author metadata with no connectivity (e.g. on a flight); saves queue locally and publish to Drive on reconnect. This replaces the earlier assumption that offline editing was out of scope.
- Q: How does footage get onto the device before going offline? → A: No pin concept. Opening a video already downloads the full original, and nothing evicts it automatically, so whatever the user has opened is available offline. Cached videos must persist until the user clears them — including across system storage pressure.
- Q: When do queued saves reach Drive? → A: Automatically on reconnect, with a visible pending count and clear reporting of failures. The checkmark remains the moment of user intent; syncing completes an instruction already given rather than making a new decision.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Author and save metadata for one video (Priority: P1)

A solo creator keeps source footage in a Google Drive folder. They connect that folder, open a clip, watch it, type ideas into comments, tag it with keywords, drop markers on the exact frames worth using, and confirm the save. Three sidecar files appear in Drive next to the video. Later they download the folder to their computer and use those sidecars as the starting point for editing.

**Why this priority**: This is the entire product in one slice. Connecting a folder, previewing, authoring, and saving is the minimum that produces something an editor can consume. Every other story either refines or extends this one.

**Independent Test**: Connect a real Drive folder containing one video, open it, add comments, keywords, and two markers, save, then inspect Drive and confirm the `.json`, `.csv`, and `.otio` files exist beside the video with the authored values in them.

**Acceptance Scenarios**:

1. **Given** the user has no connected folders, **When** they tap **+**, sign in with their Google account, and select a Drive folder, **Then** that folder appears in their saved folder list and its videos are listed.
2. **Given** a folder with videos is open, **When** the user selects a video, **Then** the video downloads to a local cache and plays with frame-accurate positioning.
3. **Given** a video is open, **When** the user enters comments, adds keywords, and places a marker with a name, note, and color at a chosen frame, **Then** those values appear in the editor as unsaved changes.
4. **Given** a video has unsaved authored metadata, **When** the user taps the checkmark, **Then** `<videofilename>.json`, `<videofilename>.csv`, and `<videofilename>.otio` are written to the same Drive folder as the video, and the user is told the save succeeded.
5. **Given** a video already has sidecars in Drive, **When** the user saves again, **Then** the existing sidecars are replaced with the current state (last write wins) rather than duplicated.
6. **Given** a marker was placed at a known frame, **When** the resulting `.otio` is imported into the target editor, **Then** the marker appears at that exact frame with its name, note, and color intact.

---

### User Story 2 - Reopen a video and continue editing (Priority: P2)

The creator returns to a clip they annotated last week. Opening it restores everything they authored — comments, keywords, and every marker at its original frame — so they can refine rather than start over.

**Why this priority**: Without this, authored work is write-only and the app is a one-shot tool. It is the difference between a usable workflow and a demo, but the P1 slice still delivers value on its own.

**Independent Test**: Save metadata for a video, close it, reopen it, and confirm every authored value returns unchanged; edit one marker, save, reopen, and confirm the edit persisted.

**Acceptance Scenarios**:

1. **Given** a video with an existing canonical sidecar in Drive, **When** the user opens the video, **Then** its comments, keywords, and markers load into the editor automatically.
2. **Given** loaded metadata, **When** the user edits a marker's note and saves, **Then** reopening the video shows the edited note and the original frame position.
3. **Given** a video with no sidecars, **When** the user opens it, **Then** the editor starts empty with the video's technical facts read from the file and no error is shown.
4. **Given** a sidecar that is damaged beyond parsing, **When** the user opens the video, **Then** the app reports that the existing metadata could not be loaded and does not silently discard or overwrite it without an explicit user action.
5. **Given** a readable sidecar containing some fields this build does not recognize, **When** the user opens the video, **Then** the recognized fields load normally, a small warning notes that some metadata could not be read, and saving afterwards leaves the unrecognized fields intact.
6. **Given** a video whose comments, keywords, and markers are all cleared, **When** the user saves, **Then** its three sidecars are removed from Drive and the video no longer shows as having metadata.

---

### User Story 3 - Author offline and publish on reconnect (Priority: P2)

The creator watches a folder's clips before a flight, then works through them in the air with no connectivity — writing comments, tagging, and dropping markers. Each clip they finish is confirmed with the checkmark as usual. Nothing is lost while offline, and when the phone reconnects on landing, the pending saves publish to Drive on their own.

**Why this priority**: A flight or a shoot with no signal is prime annotation time — it is one of the main occasions this work actually gets done. Without it, the app is unusable exactly when the user has time to use it. It sits below the core authoring loop only because that loop must exist first.

**Independent Test**: Open several videos while connected, disable all connectivity, author metadata on each and confirm the saves, then restore connectivity and confirm every pending save reaches Drive with its authored values intact and the pending count returns to zero.

**Acceptance Scenarios**:

1. **Given** a video whose original is already cached, **When** the user opens it with no connectivity, **Then** it plays frame-accurately and its previously loaded metadata is available for editing.
2. **Given** the user is offline, **When** they author metadata and tap the checkmark, **Then** the save is recorded locally, the video shows as saved-but-pending, and no error is shown.
3. **Given** one or more pending saves, **When** the app is closed and reopened while still offline, **Then** all pending saves and their authored values survive intact.
4. **Given** pending saves exist, **When** connectivity returns, **Then** the sidecars publish to Drive automatically, the pending count falls to zero, and the user is not asked to confirm again.
5. **Given** pending saves exist, **When** the user views the folder or video list, **Then** the number of pending saves is visible.
6. **Given** a pending save that fails to publish, **When** the sync is attempted, **Then** the save stays pending, the failure is reported, and the authored values are not discarded.
7. **Given** a video that is not cached, **When** the user tries to open it offline, **Then** the app explains it is unavailable offline rather than failing obscurely.
8. **Given** a video with pending offline edits, **When** the user clears that folder's video cache, **Then** the pending edits survive and still publish on reconnect.

---

### User Story 4 - Manage a library of folders and local storage (Priority: P3)

The creator works across several shoots, each in its own Drive folder. They switch between saved folders, narrow a long video list by keyword to find the clips from one setup, and clear cached downloads for a folder when the phone runs low on space.

**Why this priority**: Quality-of-life for repeat use at real library sizes. A single folder with a short list works fine without it, so this follows the core loop.

**Independent Test**: Connect two folders, switch between them, filter one folder's list by a keyword and confirm only matching videos show, then clear that folder's cache and confirm cached videos are gone while Drive and the saved metadata are untouched.

**Acceptance Scenarios**:

1. **Given** two or more connected folders, **When** the user selects a different folder, **Then** the video list switches to that folder's contents.
2. **Given** a folder whose videos carry keywords, **When** the user filters by a keyword, **Then** only videos carrying that keyword are listed.
3. **Given** a video list, **When** it is displayed, **Then** each video shows a thumbnail and an indicator of whether metadata already exists for it.
4. **Given** cached video downloads for a folder, **When** the user clears that folder's cache, **Then** the local copies are removed, the videos remain in Drive, their sidecars are unaffected, and reopening a video re-downloads it.

---

### Edge Cases

- **Save interrupted mid-write** (connection lost, app backgrounded): no partial or truncated sidecar is left in Drive and the previous sidecars remain valid. The save is not lost — it stays pending and publishes when connectivity returns.
- **Connectivity lost between opening a video and saving it**: the save is confirmed normally and queues; the user is not made to retry.
- **Pending save that keeps failing** for a reason other than connectivity (access revoked, folder deleted): it stays queued and the failure is reported with its cause. Authored values are never discarded to clear the queue.
- **Device storage fills while offline**: cached videos are never silently purged (FR-010), so the app must surface the storage problem rather than lose footage the user is relying on.
- **App force-quit with pending saves**: pending saves and their values survive and publish on the next launch with connectivity.
- **Download interrupted or cancelled**: the user is told the video could not be fully downloaded and can retry; a partial cached file is never played or treated as complete, and does not count as a cached copy.
- **Connection drops from Wi-Fi to cellular mid-download**: the download does not silently continue on cellular; the user is asked whether to continue given the remaining size.
- **Only some sidecars exist** (e.g. `.json` present, `.otio` missing): the canonical `.json` is the source of truth; the missing projections are regenerated on the next save.
- **Sidecar written by a different app version** (older or newer schema): the recognized fields load, unrecognized ones are kept aside and written back untouched on save, and the user sees a small warning. The declared schema version is recorded for diagnostics, not used to gate reading.
- **Sidecars changed outside the app** since the video was opened: the save overwrites them (last write wins). No merge is attempted.
- **Metadata cleared then saved**: the video's sidecars are deleted from Drive and the list stops showing it as having metadata. If the clear-and-save is interrupted partway, the same all-or-nothing rule applies — either all three sidecars are gone or all remain. Cleared offline, the deletion queues like any other save and takes effect in Drive on reconnect.
- **Video saved with only unrecognized fields present** (nothing the app itself can edit): treated as non-empty, so the sidecars are preserved rather than deleted.
- **Frame rate cannot be determined** from the video file: markers cannot be positioned exactly, so the app refuses to author frame-accurate markers for that video rather than approximating.
- **Variable frame rate footage** (frame spacing not constant, common in phone and screen-recorded video): the app detects it and degrades to whole-video authoring only — playback, comments, and keywords still work, marker authoring is disabled with an explanation. Expected to be rare in practice, since the target footage is shot at constant 24 or 60 fps.
- **Source timecode absent** from the file: the metadata records that no source timecode was present rather than inventing a zero start.
- **Two videos in one folder with the same stem** (`clip.mp4`, `clip.mov`): each gets its own sidecar set keyed on the full filename including extension, with no collision.
- **Video renamed in Drive**: metadata is bound to the filename, so the renamed video opens empty and the old sidecars stay in the folder under the old name, unreferenced. Nothing is deleted, and the user can recover the work by renaming the video back.
- **A video is given the name of a previously deleted video** that still has sidecars: the new video inherits those sidecars, since the filename is the identity. This follows from the filename-identity rule and is accepted.
- **Video removed from Drive** while cached locally, or **access to a connected folder revoked**: the app reports the folder or video is unavailable instead of failing silently.
- **Marker at the last frame, or a range marker extending past the end**: positions must stay within the video's frame count.
- **Two markers on the same frame**: both are kept and exported.
- **Folder with no videos, or a very large folder**: the list renders correctly and remains usable.

## Requirements *(mandatory)*

### Functional Requirements

**Folder connection and library**

- **FR-001**: Users MUST be able to add a Google Drive folder by signing in with their own Google account and selecting the folder.
- **FR-002**: System MUST save connected folders to a persistent list that survives app restarts, and let users switch the active folder.
- **FR-003**: System MUST request the level of Drive access needed to read videos it did not upload and to write files next to them, and MUST explain to the user why that access is needed.
- **FR-004**: System MUST list the videos in the active folder with a thumbnail for each and an indicator of whether metadata already exists for that video.
- **FR-005**: Users MUST be able to filter and sort the active folder's video list by keyword.

**Preview**

- **FR-006**: System MUST download a video's original file to a local cache when the user opens it, and report clearly if the download does not complete.
- **FR-006a**: System MUST start the download without prompting when the device is on Wi-Fi. On a cellular connection it MUST show the file's size and ask the user to confirm before starting.
- **FR-006b**: System MUST show download progress and let the user cancel a download in flight, leaving no partial file treated as playable.
- **FR-007**: System MUST play the cached video with frame-accurate positioning, including stepping one frame at a time in both directions and scrubbing to a specific frame.
- **FR-008**: System MUST display the current position as an exact integer frame number.
- **FR-009**: Users MUST be able to clear the local cache for a folder, removing cached video copies without affecting Drive contents, locally held metadata, or pending saves.
- **FR-010**: System MUST keep a cached video on the device until the user clears it — surviving app restarts, and not silently removed by the system when storage runs low. There is no automatic eviction, and no separate action is needed to make a video available offline: opening it is enough.

**Metadata authoring**

- **FR-011**: System MUST read each video's technical facts from its file — codec, resolution, frame rate as an exact rational value, and duration — and present them read-only.
- **FR-012**: System MUST read source timecode from the video file where present, and record its absence explicitly where it is not, without substituting a default.
- **FR-013**: Users MUST be able to author free-text comments for a whole video.
- **FR-014**: Users MUST be able to add and remove keywords on a whole video.
- **FR-015**: Users MUST be able to add, edit, and delete markers within a video, each with a position, a name, a note, and a color.
- **FR-016**: System MUST store every marker position as an integer frame offset paired with the video's exact frame rate, never as a rounded or approximated time value.
- **FR-017**: Users MUST be able to give a marker a duration (a range) or leave it at a single frame (a point).
- **FR-018**: System MUST record that each authored value was entered manually by the user (provenance), so later automatically generated values can be distinguished from hand-authored ones.
- **FR-019**: System MUST reject authoring frame-accurate markers on a video whose exact frame rate cannot be determined, and tell the user why, rather than approximating positions.
- **FR-019a**: System MUST detect footage whose frame spacing is not constant (variable frame rate). On such a video it MUST still allow playback, comments, and keywords, but MUST disable marker authoring and explain that frame positions cannot be guaranteed for that file. It MUST NOT write markers for a video it has identified as variable rate.
- **FR-020**: System MUST NOT offer scene/shot/take fields, ratings, status, or color labels at the whole-video level in this version.

**Reading existing metadata**

- **FR-021**: System MUST look for existing sidecars next to a video when it is opened with connectivity available, and load their metadata into the editor. Opened offline, the video's locally held metadata (FR-033) is used instead.
- **FR-021a**: System MUST associate a video with its metadata by the video's full filename including extension, and by nothing else. Renaming a video in Drive therefore separates it from its existing sidecars: the renamed video opens with no metadata, and the old sidecars remain in the folder under the old name. The app MUST NOT delete those orphaned sidecars.
- **FR-022**: System MUST treat the canonical file as the single source of truth on read; the editor projections are never read back.
- **FR-023**: System MUST report clearly when existing metadata is present but is damaged beyond parsing, and MUST NOT overwrite it without an explicit user save.
- **FR-023a**: System MUST read a canonical file leniently regardless of the schema version it declares: every field the app recognizes is loaded, unrecognized fields are ignored for editing purposes, and the user is shown a small warning that some metadata could not be read. A version mismatch alone MUST NOT make a file unreadable.
- **FR-023b**: System MUST preserve fields it did not recognize on read and write them back unchanged on save, so that a partial read followed by a save never destroys metadata the app does not understand.

**Saving**

- **FR-024**: Users MUST be able to save a video's metadata by an explicit per-video confirm action. The system MUST NOT author or publish metadata the user did not confirm; the only writes it makes without a fresh user action are the delivery of saves the user has already confirmed (FR-034).
- **FR-025**: On save, system MUST write three files into the same Drive folder as the video, each named with the video's full filename (including its extension) as the prefix: a canonical metadata file, a whole-video metadata file for the editor, and a timeline file carrying the markers.
- **FR-026**: System MUST always write the canonical file on save; the other two MUST be generated deterministically from it, so identical canonical content always produces identical projections.
- **FR-027**: System MUST replace a video's existing sidecars on save rather than duplicating them, with the most recent save winning; no merge with outside changes is attempted.
- **FR-028**: System MUST leave no partial or unreadable sidecar in Drive if a save is interrupted, and MUST report the failure to the user.
- **FR-029**: System MUST indicate when a video has unsaved changes and warn before those changes would be discarded.
- **FR-029a**: Users MUST be able to remove a video's metadata by clearing it: when a video with no comments, no keywords, and no markers is saved, the system MUST delete that video's existing sidecars from Drive rather than writing empty ones, and MUST tell the user the metadata was removed. Saving an already-empty video that has no sidecars MUST do nothing.
- **FR-030**: System MUST record in the canonical file which schema version it was written against, and pin the timeline file to a specific known schema version.
- **FR-031**: Markers MUST reach the editor through the timeline file; the whole-video metadata file carries only comments and keywords, which is a known and accepted limitation of that format.

**Offline authoring and sync**

- **FR-032**: System MUST allow full authoring with no connectivity for any video whose original is cached: playback, frame-accurate marker placement, comments, keywords, and confirming a save MUST all work offline.
- **FR-033**: System MUST hold each video's canonical metadata locally so it can be read and edited without reaching Drive, and MUST refresh that local copy from the video's sidecar whenever the video is opened with connectivity available.
- **FR-034**: System MUST record a confirmed save that cannot reach Drive as pending, and MUST publish it automatically once connectivity returns, without asking the user to confirm the save a second time.
- **FR-035**: System MUST persist pending saves and their authored values across app restarts and device restarts until they are published or the user discards them.
- **FR-036**: System MUST keep pending saves and locally held metadata separate from cached video files, so that clearing a folder's video cache never destroys unpublished work.
- **FR-037**: System MUST show how many saves are pending, and which videos they belong to.
- **FR-038**: System MUST keep a pending save queued and report the failure if publishing it fails, and MUST NOT discard the authored values. Publishing MUST remain all-or-nothing per video (FR-028): a video's sidecars either all publish or the save stays pending.
- **FR-039**: System MUST explain that a video is unavailable offline when the user opens one whose original is not cached, rather than failing obscurely.
- **FR-040**: System MUST publish pending saves on any connection without prompting; the cellular confirmation in FR-006a applies to video downloads only, since sidecars are small.

### Key Entities *(include if feature involves data)*

- **Connected Folder**: A Drive folder the user has added. Holds a display name, a reference to the folder in Drive, and the set of videos found inside it. Every folder exports both projection formats.
- **Video**: One video file in a connected folder. Its **identity is its full filename including extension** — this is what binds it to its metadata. Its Drive reference is only a locator used to fetch bytes, not an identity. Also carries read-only technical facts (codec, resolution, exact rational frame rate, duration, source timecode where present), and whether it currently has cached bytes on the device.
- **Video Metadata (canonical)**: The source-of-truth record for one video. Combines the video's identity, its technical facts, the user's comments and keywords, its markers, provenance for every authored value, and the schema version it was written against. One per video, stored beside it in Drive.
- **Marker**: A user-placed annotation inside a video. Holds a position as an integer frame offset with the exact frame rate, an optional duration in frames, a name, a note, and a color. Many per video; multiple markers may share a frame.
- **Sidecar Set**: The three files written beside a video on save — the canonical record plus two deterministic projections of it (whole-video metadata, and a timeline carrying the markers). Named from the video's full filename so different videos sharing a stem never collide.
- **Local Cache**: Downloaded copies of original videos, scoped per folder, kept until the user clears them. Clearing affects video bytes only — never Drive contents, locally held metadata, or pending saves. A video's presence here is what makes it usable offline.
- **Local Metadata Store**: The on-device copy of each video's canonical metadata. What the user actually edits against, and what makes offline authoring possible. Refreshed from the video's sidecar whenever it is opened with connectivity. Durable — it holds work that may not have reached Drive yet, so it is never treated as disposable.
- **Pending Save**: A save the user confirmed that has not yet reached Drive. Holds the video it belongs to and the metadata to publish. Survives app and device restarts, publishes automatically on reconnect, and stays queued if publishing fails. Publishes all-or-nothing per video.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every marker the user places lands in the editor at the exact same frame — a 1:1 match on 100% of markers across a test set of clips at 23.976, 24, 25, 29.97, and 60 frames per second — 24 and 60 being the rates the user actually shoots, and the others covering the fractional-rate cases. Any deviation is a defect, not a tolerance.
- **SC-002**: Comments and keywords authored in the app appear on the matching clip in the editor for 100% of saved videos.
- **SC-003**: Reopening a previously saved video restores 100% of its authored values — comments, keywords, and every marker's frame, name, note, color, and duration — with no drift across repeated save/reopen cycles.
- **SC-004**: A user who has already connected a folder can go from opening a clip to a completed save in under 3 minutes for a clip with a handful of markers, excluding video download time.
- **SC-005**: Frame stepping and scrubbing land on the requested frame every time, and the displayed frame number always matches the frame shown.
- **SC-006**: Connecting a Drive folder for the first time, including sign-in, takes under 2 minutes.
- **SC-007**: Zero partial or unreadable sidecars in Drive across a test run that interrupts saves — every save either completes fully or leaves the previous state intact, and reports which happened.
- **SC-008**: Clearing a folder's cache reclaims all of that folder's cached video bytes and leaves 100% of Drive contents and saved metadata intact.
- **SC-009**: The app never approximates a frame position: on any video whose exact frame rate cannot be determined, it refuses marker authoring with a clear explanation rather than writing an approximate value.
- **SC-010**: Identical canonical metadata always produces byte-identical projection files, verified by regenerating projections for the same input.
- **SC-011**: No download ever starts over cellular without an explicit confirmation showing the file's size — 100% of cellular downloads are confirmed first, and every in-flight download can be cancelled.
- **SC-012**: Clearing a video's metadata and saving removes all three of its sidecars from Drive, verified across a test set; no empty sidecar is ever left behind.
- **SC-013**: Fields the app does not recognize survive a full load-and-save cycle unchanged, verified by saving a sidecar containing unknown fields and comparing them byte-for-byte afterwards.
- **SC-014**: On variable-rate footage the app never writes a marker, and always explains why authoring is unavailable — 100% of detected variable-rate files.
- **SC-015**: With no connectivity, every authoring action available online is available for a cached video — playback, frame stepping, comments, keywords, markers, and confirming a save — with no degradation in frame accuracy.
- **SC-016**: Zero authored values are lost across a full offline cycle: 100% of saves confirmed offline survive app and device restarts and publish intact on reconnect, verified across a test run of many videos annotated with connectivity disabled.
- **SC-017**: Pending saves publish automatically within seconds of connectivity returning, with no user action, and the pending count reaches zero.
- **SC-018**: Clearing a folder's video cache while saves are pending destroys zero pending saves — all still publish on reconnect.

## Assumptions

**Scope and users**

- Single user per installation, using their own Google account. No teams, sharing, collaboration, or permission model beyond what Drive itself enforces.
- The app is for personal use. Publishing to a store — and the Google review that a broad Drive access scope would trigger — is out of scope for this version.
- All metadata is authored by hand. No automatic generation (speech-to-text, shot detection, object detection) in this version.
- Out of scope for this version: proxy or lower-quality downloads, on-device transcoding, FCPXML export, Android, and streaming preview without a full download.
- Frame-accurate work requires a downloaded copy; the app does not attempt frame accuracy against a stream.

**Behavior chosen where the source description left it open**

- **Sort options**: the list sorts by name, by modified date, and by whether metadata exists, in addition to filtering by keyword. Keyword filtering matches any of the selected keywords.
- **Keyword source**: the filter offers keywords already present in the folder's saved metadata; the user can also type a new keyword when authoring.
- **Marker colors**: a fixed palette matching the colors the target editor recognizes, rather than free color entry, so colors survive the round trip.
- **Save granularity**: one video at a time. No batch save across a folder in this version.
- **Conflict handling**: last write wins, with no locking, versioning, or merge. This is acceptable because there is only one user on one device at a time.
- **Sidecar authorship**: sidecars are only ever written by this app's UI. Nobody hand-edits them in Drive, so the read path can be lenient (FR-023a) rather than strictly version-gated. The schema version in the canonical file is diagnostic, not a gate.
- **Cache eviction**: the cache is cleared manually per folder. No automatic size cap or age-based eviction in this version.
- **Offline**: authoring is fully available offline for any cached video, and confirmed saves queue and publish on reconnect (FR-032 to FR-040). Only the operations that inherently need Drive require connectivity: adding a folder, listing a folder's videos, and downloading an original. A video must have been opened at least once while connected to be usable offline.
- **Offline conflict window**: a queued save may publish hours after it was authored, and still overwrites whatever is in Drive (last write wins). Acceptable for a single user on a single device, where nothing else writes these sidecars.
- **Video discovery**: the app lists videos directly in a connected folder and does not recurse into subfolders.

**Dependencies and environment**

- Requires a Google account with the target footage already in Drive, and connectivity for adding folders, listing videos, and downloading originals. Authoring and confirming saves do not require connectivity.
- Requires enough free space on the device for every original the user wants available offline at once, not just the largest single video.
- The target editor is DaVinci Resolve, version 18.6.5 or later, which is where marker import through the timeline format has been observed to work.
- **Both previously unverified editor behaviors are now CONFIRMED** by the technical spike (2026-07-17), run against DaVinci Resolve on the user's real 23.976 footage: whole-video metadata imports correctly from the projection file, and markers map to **exact frames 1:1** through the timeline file — including the first and last frames, with range durations intact. Both projections are necessary and non-overlapping: the timeline file carries markers but no comments/keywords, confirming FR-031. Field labels, encoding, and coordinate conventions are recorded in the plan's contracts. Implementation is unblocked.
- The user's own footage is constant-rate. **Verified against real footage (DJI Osmo Pocket 3): what the camera labels "24 fps" is actually 23.976 (`24000/1001`)** — the fractional NTSC rate. Fractional rates are therefore the *primary* path, not an edge case, which makes exact rational frame handling load-bearing rather than precautionary. Variable-rate footage is still handled defensively (FR-019a) rather than optimized for.
- Source timecode reading from arbitrary MP4/MOV files is best-effort and is not guaranteed to be present.
- Frame-accurate stepping may require platform-level video capability beyond a general-purpose player; this is an implementation concern, not a change in requirement.
