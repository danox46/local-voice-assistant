import type { IntegrationBoundary, ListenerMode } from "./types";

export const pushToTalkListener: ListenerMode = {
  id: "push-to-talk",
  label: "Push to talk",
  startsAutomatically: false
};

export const futureListenerModes: ListenerMode[] = [
  {
    id: "wake-phrase",
    label: "Wake phrase",
    startsAutomatically: true
  },
  {
    id: "always-listen",
    label: "Always listen",
    startsAutomatically: true
  }
];

export const integrationBoundaries: IntegrationBoundary[] = [
  {
    id: "home-assistant",
    label: "Home Assistant events and webhooks",
    enabled: false
  },
  {
    id: "codex-adapter",
    label: "Codex thread bridge",
    enabled: false
  }
];
