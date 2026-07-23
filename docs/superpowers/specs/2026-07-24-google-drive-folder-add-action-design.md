---
title: Google Drive folder Add action
date: 2026-07-24
status: approved
---

# Goal

Let users add a non-root Google Drive folder even when the picker renders no child folders.
Keep video files hidden in the folder picker.
Make folder selection visible beside the current folder name instead of in the footer.

# Current behavior

- `FolderPicker` lists subfolders only.
- A folder containing only videos shows `No subfolders here`.
- A footer action connects the current non-root folder.
- `onPick({ id, name })` starts the existing validation, persistence, and navigation flow.

# Interaction

- Header layout: `Cancel | Folder name | Add`.
- Show `Add` on the right for every non-root folder.
- Hide `Add` on `My Drive` and retain an equal-width spacer to keep the title centered.
- Remove the footer Connect action.
- Keep `No subfolders here` when the current folder has no child folders.
- Do not render video files or previews in the picker.
- Do not add actions to child-folder rows.

# Component behavior

Change only the selection affordance in `src/features/folders/folderPicker.tsx`.

- `Add` calls the existing `onPick` callback with the current folder ID and name.
- Preserve breadcrumb navigation and picker reset behavior.
- Preserve the modal `SafeAreaProvider` and header layout.
- Keep `Add` available for a non-root folder during empty and listing-error states.
- Connection failures continue through the existing home-screen alert flow.

# Data flow

1. User navigates from `My Drive` into a folder.
2. Picker lists only direct child folders.
3. User selects `Add` from the current-folder header.
4. Existing `onPick` handling confirms Drive metadata access.
5. Existing repository logic persists the folder ID and name.
6. Rushmark opens the connected-folder screen and loads its videos through the existing flow.

# Non-goals

- Rendering videos in the picker.
- Changing Drive queries, OAuth scopes, pagination, or permissions.
- Adding My Drive root, Shared Drive folders, or folder shortcuts.
- Changing database schema or connected-folder behavior.
- Adding row-level or empty-state-specific selection actions.

# Validation

Add focused `FolderPicker` component coverage:

- `My Drive` does not show `Add`.
- A child folder shows `Add` in the header.
- A folder without child folders shows `Add` and `No subfolders here`.
- Pressing `Add` emits the current folder `{ id, name }` exactly once.
- A listing error leaves the current non-root folder addable.
- The footer Connect action is absent.

Run TypeScript checks and the existing test suite.
No external Drive integration test is required because Drive API and authorization behavior do not change.
