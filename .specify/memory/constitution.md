<!--
SYNC IMPACT REPORT
==================
Version change: (unratified template) → 1.0.0
Bump rationale: MINOR-equivalent initial ratification. The file previously held
only unfilled placeholders; no principles were in force, so nothing was removed
or redefined. First adoption → 1.0.0.

Principles defined (all new — template slots were placeholders):
  - [PRINCIPLE_1_NAME] → I. Exactness Over Convenience (NON-NEGOTIABLE)
  - [PRINCIPLE_2_NAME] → II. Never Lose Authored Work
  - [PRINCIPLE_3_NAME] → III. The Canonical Record Is The Only Authority

Sections:
  - [SECTION_2_NAME] → Additional Constraints
  - [SECTION_3_NAME] → Development Workflow
  - Governance → filled

Removed:
  - [PRINCIPLE_4_NAME], [PRINCIPLE_5_NAME] template slots. Deliberate: three
    enforced principles beat five ignored ones. Each principle here is grounded
    in a decision already proven load-bearing by the Phase 0 spike.

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check placeholder is
     generic ("[Gates determined based on constitution file]"); resolves against
     this file. No edit needed.
  ✅ .specify/templates/tasks-template.md — notes that tests are OPTIONAL by
     default; amended to record that Principle I and III mandate specific
     verification regardless.
  ✅ .specify/templates/spec-template.md — no constitution references. No edit.
  ✅ specs/001-drive-video-metadata/plan.md — Constitution Check re-evaluated
     against these principles (previously "PASS (vacuously — no constitution)").

Follow-up TODOs: none. No placeholders deferred.
-->

# Rushmark Constitution

## Core Principles

### I. Exactness Over Convenience (NON-NEGOTIABLE)

A frame position is either exactly right or it is a defect. There is no tolerance band.

- Frame rates MUST be stored and carried as exact rationals (`24000/1001`), never as floats
  (`23.976`). Rate equality MUST be compared as `a.num*b.den == b.num*a.den`, never as float
  comparison.
- Marker positions MUST be integer frame offsets paired with the exact rate. No frame position
  may pass through a float representation at any layer — including the native bridge, where the
  interface speaks integer frames and never seconds.
- When an exact rate cannot be determined, or footage is variable-rate, the app MUST refuse the
  operation and explain why. It MUST NOT guess, round, or approximate.
- A seek or step MUST report the frame it actually landed on, not the frame requested.

**Rationale**: The user's camera reports "24 fps" and delivers 23.976 (`24000/1001`) — so
fractional rates are the primary path, not an edge case. The Phase 0 spike proved 1:1 frame
mapping into DaVinci Resolve is achievable on that exact footage, including the first and last
frames. Because it is achievable, any deviation is a bug rather than a limitation. Approximation
here fails silently and compounds: markers land wrong in the editor months later with no
indication of when it started.

### II. Never Lose Authored Work

Authored work is the product. Nothing may discard it to make a code path simpler.

- Metadata confirmed offline MUST survive app and device restarts, and MUST publish on
  reconnect without asking the user to confirm a second time.
- A pending save MUST leave the queue only by success or by explicit user discard. Failure keeps
  it queued with the cause recorded and surfaced. There is no path from pending to dropped.
- Fields the app does not recognize MUST be preserved verbatim on read and written back
  unchanged on save.
- Clearing cached video MUST NOT be able to reach unpublished work. The separation MUST hold by
  construction, not by careful coding.
- Destructive operations MUST be explicit user actions, never side effects.

**Rationale**: Offline authoring is a core requirement — a flight is prime annotation time, and
the app is useless if work made there can evaporate. Field preservation matters for a subtler
reason: without it, an older build reading a sidecar written by a newer one would silently delete
fields it did not understand. That is data loss authored by our own app against its own user.

### III. The Canonical Record Is The Only Authority

The canonical `.json` is the source of truth. Everything else is derived.

- The `.csv` and `.otio` MUST be pure, deterministic projections of the canonical record.
  Identical canonical content MUST produce byte-identical projections.
- Projections MUST NEVER be authored into by hand, and MUST NEVER be read back as a source of
  truth. Any projection MUST be fully regenerable from the canonical record alone.
- Editor-specific quirks — coordinate systems, header spellings, encoding constraints — MUST be
  confined to the projection layer. They MUST NOT leak into the canonical model.
- Schema versions MUST be recorded, and MUST be diagnostic rather than a gate on reading.

**Rationale**: The Phase 0 spike found that OTIO ranges live in media-timecode coordinates rather
than 0-based frame offsets — a bug that lived entirely inside the projection while the canonical
model stayed correct throughout, and was fixed by changing one writer. That containment is only
available because projections are derived. Hand-patch a projection once and the property is gone
permanently, along with the ability to change editors without touching the model.

## Additional Constraints

- **Client-only**: no backend, no server dependency. All work happens on-device and against the
  Google Drive API.
- **Single user, single device**: no collaboration, sharing, or permission model beyond what
  Drive itself enforces. Last-write-wins is an accepted consequence, not an oversight.
- **iOS only**: no Android, no web.
- **Format assumptions MUST be verified against the real tool**, not taken from documentation or
  memory, before they are relied upon. The spike established this the hard way: a guessed byte
  order mark, guessed CSV headers, and a guessed coordinate system each produced an error message
  that pointed somewhere else entirely.

## Development Workflow

Governance is proportionate to a one-person project. There are no review gates and no ceremony
that a solo developer cannot honor.

- `/speckit-plan` MUST show how a design satisfies these principles. Violations MUST be recorded
  in Complexity Tracking with the simpler alternative and why it was rejected — an honest,
  bounded exception is acceptable; an unstated one is not.
- Verification that these principles demand is NOT optional, regardless of the general stance on
  tests: frame math round-trips at every supported rate (Principle I), and golden-file tests
  pinning projection determinism (Principle III).
- Compromises forced by a platform MUST be documented in the open rather than described as
  guarantees. Where Drive offers no multi-file transaction, the design says so and states what it
  provides instead.

## Governance

This constitution supersedes other practices where they conflict.

- **Amendments** MUST be recorded in this file with a version bump and a Sync Impact Report, and
  MUST propagate to dependent templates and any in-flight plans in the same change.
- **Versioning** follows semantic versioning: MAJOR for removing or redefining a principle in a
  backward-incompatible way; MINOR for adding a principle or materially expanding guidance; PATCH
  for clarifications and wording.
- **Compliance review** happens at `/speckit-plan` (Constitution Check, before Phase 0 and again
  after Phase 1). A principle that keeps getting violated is either wrong or not really a
  principle — amend it deliberately rather than eroding it silently.
- These three principles were chosen because each has a plausible future argument for breaking it
  and a concrete reason past-you should win. Adding principles nobody enforces devalues the ones
  that matter.

**Version**: 1.0.0 | **Ratified**: 2026-07-17 | **Last Amended**: 2026-07-17
