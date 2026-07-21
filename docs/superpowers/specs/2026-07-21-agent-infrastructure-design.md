---
title: Agent instruction infrastructure
date: 2026-07-21
status: approved
---

# Goal

Create a portable, low-maintenance instruction hierarchy for coding agents that support `AGENTS.md`.
Preserve the Rushmark constitution and active feature specifications as higher-level authorities.
Do not add tool-specific adapters until a demonstrated compatibility need exists.

# Instruction hierarchy

- `.specify/memory/constitution.md`: non-negotiable product principles.
- Active `specs/<feature>/spec.md`, `plan.md`, contracts, and tasks: feature scope and design.
- Root `AGENTS.md`: repository-wide engineering and workflow rules.
- Nearest nested `AGENTS.md`: additive subsystem constraints.

A more local file may tighten repository rules but must not weaken the constitution or active specification.
Detailed schemas and requirements remain in their authoritative documents and are linked rather than copied.

# Files

- `AGENTS.md`
  - Project purpose and authority precedence.
  - Setup, supported commands, and change-scoped validation.
  - Architecture map and dependency boundaries.
  - Constitution-derived implementation constraints.
  - Spec Kit workflow and current source-of-truth locations.
  - Secrets, generated files, native project, and dirty-worktree safety.
- `src/domain/AGENTS.md`
  - Pure dependency-free domain code.
  - Exact rational and integer-frame arithmetic.
  - Canonical-record authority and deterministic projections.
  - Mandatory unit and golden validation.
- `src/data/AGENTS.md`
  - Durable offline work and pending-save state transitions.
  - Filesystem cache isolation from SQLite-authored work.
  - Drive publication ordering, retries, and surfaced failures.
  - Mandatory integration validation.
- `modules/frame-player/AGENTS.md`
  - Integer-frame-only JavaScript/Swift bridge.
  - Exact `CMTime` conversion and zero-tolerance seeking.
  - AVFoundation lifecycle and native test requirements.
- `tests/AGENTS.md`
  - Unit, integration, component, golden, and native test responsibilities.
  - Resolve-verified fixture protection.
  - Rules for regression tests and deterministic assertions.

Existing `.specify/` workflows and `.claude/skills/` remain unchanged.
No `CLAUDE.md`, `GEMINI.md`, Cursor rule, or Copilot instruction file is added.

# Agent behavior

- Preserve unrelated working-tree changes.
- Identify generated files and their source before editing them.
- Never guess, round, or add tolerance to frame positions or rates.
- Refuse unsupported or uncertain media operations with an actionable explanation.
- Keep failed publication queued unless the user explicitly discards it.
- Preserve unknown canonical fields through read/write cycles.
- Keep editor-specific behavior inside projection code.
- Surface contradictions between instructions and authoritative documents before implementation.

# Validation

Use repository-defined commands and record unavailable checks explicitly.

- TypeScript changes: typecheck, lint, and relevant Jest projects.
- Domain or projection changes: unit and golden tests are mandatory.
- Data or sync changes: integration tests are mandatory.
- Swift player changes: native XCTest and TypeScript bridge validation are mandatory.
- UI changes: component tests where behavior changes; device checks for native behavior.
- Resolve fixtures: update only after verification against the real application and representative footage.

Validate the infrastructure itself by checking paths, commands, precedence, contradictions, and markdown terseness.

# Maintenance

Update affected instruction files when scripts, architecture boundaries, constitutional principles, native interfaces, or test responsibilities change.
Prefer changing one authoritative rule over copying it into multiple files.
Add tool-specific adapters only when a target tool fails to discover this hierarchy.
