import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BackgroundSession } from "../shared/types";
import {
  classifySessionSupervision,
  listBackgroundSessions,
  resetBackgroundSessionStateForTests
} from "./sessionManager";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  resetBackgroundSessionStateForTests();
});

function session(overrides: Partial<BackgroundSession>): BackgroundSession {
  return {
    id: "session-1",
    title: "Test session",
    status: "running",
    mode: "execute",
    prompt: "Do the thing",
    createdAt: "2026-06-03T10:00:00.000Z",
    startedAt: "2026-06-03T10:00:00.000Z",
    report: {
      summary: "",
      changed: "",
      verified: "",
      blockers: "",
      next: ""
    },
    supervision: {
      level: "normal",
      reason: "",
      userNeeded: false,
      shouldNotify: false,
      checkedAt: "2026-06-03T10:00:00.000Z"
    },
    focused: false,
    ...overrides
  };
}

describe("classifySessionSupervision", () => {
  it("marks long-running sessions as stale without notifying the user", () => {
    const result = classifySessionSupervision(
      session({ status: "running" }),
      new Date("2026-06-03T10:09:00.000Z")
    );

    expect(result.level).toBe("stale");
    expect(result.userNeeded).toBe(false);
    expect(result.shouldNotify).toBe(false);
  });

  it("marks credential or approval blockers as user-needed notifications", () => {
    const result = classifySessionSupervision(
      session({
        status: "blocked",
        report: {
          summary: "Cannot continue.",
          changed: "None.",
          verified: "Tried auth check.",
          blockers: "Need user approval and API key.",
          next: "Ask the user to confirm."
        }
      }),
      new Date("2026-06-03T10:01:00.000Z")
    );

    expect(result.level).toBe("needs-user");
    expect(result.userNeeded).toBe(true);
    expect(result.shouldNotify).toBe(true);
  });

  it("keeps ordinary technical blockers agent-actionable and quiet", () => {
    const result = classifySessionSupervision(
      session({
        status: "failed",
        report: {
          summary: "Build failed.",
          changed: "None.",
          verified: "npm test failed.",
          blockers: "TypeScript error in App.tsx.",
          next: "Fix the type error and rerun tests."
        }
      }),
      new Date("2026-06-03T10:01:00.000Z")
    );

    expect(result.level).toBe("auto-actionable");
    expect(result.userNeeded).toBe(false);
    expect(result.shouldNotify).toBe(false);
  });

  it("can describe stale sessions without treating silence as a user blocker", () => {
    const result = classifySessionSupervision(
      session({
        status: "running",
        startedAt: "2026-06-03T10:00:00.000Z"
      }),
      new Date("2026-06-03T10:12:00.000Z")
    );

    expect(result.level).toBe("stale");
    expect(result.reason).toContain("quiet");
    expect(result.userNeeded).toBe(false);
  });

  it("hydrates completed sessions from saved report files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-session-reports-"));
    const reportDir = path.join(tempDir, "work", "session-reports");
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportDir, "session-restored.md"),
      [
        "# Restored worker",
        "",
        "Session: session-restored",
        "Status: done",
        "Mode: plan",
        "Started: 2026-06-03T10:00:00.000Z",
        "Finished: 2026-06-03T10:03:00.000Z",
        "",
        "## Summary",
        "The worker inspected the project and produced a plan.",
        "",
        "## Changed",
        "None.",
        "",
        "## Verified",
        "Read-only inspection.",
        "",
        "## Blockers",
        "None reported.",
        "",
        "## Next",
        "Review the plan.",
        "",
        "## Raw Output",
        "Session: restored",
        "Status: done"
      ].join("\n"),
      "utf8"
    );

    process.chdir(tempDir);
    resetBackgroundSessionStateForTests();

    const sessions = listBackgroundSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "session-restored",
      title: "Restored worker",
      status: "done",
      mode: "plan",
      prompt: "Restored from saved worker report."
    });
    expect(sessions[0].report.summary).toContain("inspected the project");
  });
});
