import crypto from "node:crypto";
import type { ActivityEvent, ActivityEventKind } from "../shared/types";

const MAX_EVENTS = 80;
const events: ActivityEvent[] = [];

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
  events.unshift(event);
  events.splice(MAX_EVENTS);
  return event;
}

export function listActivityEvents() {
  return [...events];
}

export function resetActivityEvents() {
  events.splice(0, events.length);
}
