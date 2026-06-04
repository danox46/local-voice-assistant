export interface VoiceCommandExample {
  category: "planning" | "workers" | "settings" | "audio";
  phrase: string;
  description: string;
}

export const voiceCommandCatalog: VoiceCommandExample[] = [
  {
    category: "audio",
    phrase: "Tensoon",
    description: "Wake the app and start listening when the wake phrase is enabled."
  },
  {
    category: "planning",
    phrase: "start a new chat",
    description: "Clear the main planning conversation while keeping worker history."
  },
  {
    category: "planning",
    phrase: "catch me up on the planning session",
    description: "Hear and read a short recap of the saved planning context."
  },
  {
    category: "planning",
    phrase: "retry last turn",
    description: "Remove the latest saved planner turn and run that user request again."
  },
  {
    category: "settings",
    phrase: "switch to plan mode",
    description: "Make new Codex workers inspect and plan without editing files."
  },
  {
    category: "settings",
    phrase: "use execute mode",
    description: "Allow new Codex workers to make bounded project changes."
  },
  {
    category: "settings",
    phrase: "what mode are we in",
    description: "Report the current Codex worker mode."
  },
  {
    category: "workers",
    phrase: "focus the latest worker",
    description: "Make the newest visible worker the current follow-up context."
  },
  {
    category: "workers",
    phrase: "inspect the current worker",
    description: "Check captured worker output and report only concrete findings."
  },
  {
    category: "workers",
    phrase: "continue the focused session",
    description: "Start a follow-up worker from the focused worker report."
  },
  {
    category: "workers",
    phrase: "continue actionable blockers",
    description: "Start follow-up workers only for blocked work that does not need the user."
  },
  {
    category: "workers",
    phrase: "cancel the current worker",
    description: "Stop the focused or latest running worker."
  },
  {
    category: "workers",
    phrase: "archive completed workers",
    description: "Hide completed or cancelled workers from the main list."
  }
];

export function commandCatalogSummary(limit = 6) {
  return voiceCommandCatalog
    .slice(0, limit)
    .map((command) => `${command.phrase}: ${command.description}`)
    .join("\n");
}

export function isRetryLastTurnCommand(transcript: string) {
  const clean = transcript
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return false;
  return (
    /\b(retry|redo|rerun|regenerate)\b/.test(clean) &&
    /\b(last|previous|prior|that|answer|response|turn|message)\b/.test(clean)
  ) || /\btry (that|it|this) again\b/.test(clean);
}
