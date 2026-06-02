# Multi-Session Voice Workflow

Date: 2026-06-02

## Goal

Turn the local voice assistant into a control surface for multiple Codex sessions, not just a single chat window. The main voice session should stay available for planning, clarification, and quick decisions while background sessions run bounded work.

## Target Experience

1. The user talks naturally in the main voice session.
2. The assistant identifies work that can run independently.
3. The assistant starts a background session with a narrow task, owner, and expected output.
4. The main session keeps talking with the user instead of waiting.
5. When a background session finishes, the assistant reports:
   - what was done
   - what changed
   - what was verified
   - current blockers
   - recommended next step
6. The user can ask for status at any time.

## Session Roles

- Main session: conversational planning, decisions, routing, final integration, and spoken status.
- Background worker: bounded execution tasks with a clear write scope.
- Background explorer: read-only codebase inspection, architecture notes, or risk checks.
- Verifier: optional test/build/QA pass after implementation.

## Minimum Useful Commands

- "Start a session for this."
- "Let that run in the background."
- "What is the status?"
- "Tell me when it finishes."
- "Summarize blockers."
- "Start the next step."
- "Stop that session."

## Reporting Format

Every completed background session should come back in the same shape:

```text
Session: short nickname
Status: done | blocked | failed | still running
Summary: 1-3 sentences
Changed: files or artifacts, if any
Verified: commands or checks run, with key result
Blockers: concrete blockers only
Next: one recommended action
```

## Current Constraint

The app currently sends one foreground request to `codex exec` and waits for it to finish. It can cancel the active process, but it does not yet persist multiple jobs, expose background session status, or notify the UI when a run completes.

## Minimal App Upgrade

Add a small session manager behind the local server:

- `POST /api/sessions` to start a background Codex session.
- `GET /api/sessions` to list active and completed sessions.
- `GET /api/sessions/:id` to inspect one session.
- `POST /api/sessions/:id/cancel` to stop a running session.

Each session should store id, title, status, prompt, started time, finished time, final summary, changed files, verification result, blockers, and next action.

## UI Upgrade

Add a compact "Sessions" panel beside the conversation:

- running sessions with status and elapsed time
- completed sessions with short summaries
- blocked sessions pinned near the top
- a "read report" action that speaks the short version
- a "continue from this" action that starts the next voice turn with the session context

## Guardrails

- Do not start background execution for vague work. Ask one clarifying question or use plan mode.
- Give workers disjoint write scopes when more than one can edit files.
- Keep the main session responsible for final review and integration.
- Report uncertainty plainly instead of saying a task is done.
- Avoid publishing or deployment steps unless the user explicitly asks for them.

## First Build Slice

The first implementation should not try to recreate the whole Codex app. It should only add local job tracking for background `codex exec` runs, a sessions API, and a visible sessions panel. That is enough to test whether voice-driven orchestration feels seamless.
