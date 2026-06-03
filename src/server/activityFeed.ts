import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ActivityEvent, ActivityEventKind } from "../shared/types";

const MAX_EVENTS = 80;
const feedPath = path.join(process.cwd(), "work", "activity-events.json");
let cachedEvents: ActivityEvent[] | null = null;

function ensureWorkDir() {
  fs.mkdirSync(path.dirname(feedPath), { recursive: true });
}

function normalizeEvents(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((event): event is ActivityEvent => {
      if (!event || typeof event !== "object") return false;
      const candidate = event as Partial<ActivityEvent>;
      return Boolean(candidate.id && candidate.kind && candidate.title && candidate.createdAt);
    })
    .slice(0, MAX_EVENTS);
}

function readEvents() {
  if (cachedEvents) return cachedEvents;
  try {
    if (!fs.existsSync(feedPath)) {
      cachedEvents = [];
      return cachedEvents;
    }
    cachedEvents = normalizeEvents(JSON.parse(fs.readFileSync(feedPath, "utf8")));
    return cachedEvents;
  } catch {
    cachedEvents = [];
    return cachedEvents;
  }
}

function writeEvents(events: ActivityEvent[]) {
  ensureWorkDir();
  cachedEvents = events.slice(0, MAX_EVENTS);
  fs.writeFileSync(feedPath, JSON.stringify(cachedEvents, null, 2));
  return cachedEvents;
}

export function recordActivity(input: {
  kind: ActivityEventKind;
  title: string;
  detail: string;
  sessionId?: string;
  severity?: ActivityEvent["severity"];
}) {
  const event: ActivityEvent = {
    id: crypto.randomUUID(),
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    sessionId: input.sessionId,
    severity: input.severity ?? "info",
    createdAt: new Date().toISOString()
  };
  writeEvents([event, ...readEvents()].slice(0, MAX_EVENTS));
  return event;
}

export function listActivityEvents() {
  return [...readEvents()];
}

export function resetActivityEvents() {
  cachedEvents = [];
  try {
    fs.rmSync(feedPath, { force: true });
  } catch {
    // Best effort cleanup for tests and local resets.
  }
}
