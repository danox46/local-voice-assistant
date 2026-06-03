import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  AssistantSettings,
  BackgroundSession,
  BackgroundSessionMode,
  ConversationMessage,
  PlannerPrompt,
  PlannerQuestion,
  TextTurnResponse
} from "../shared/types";
import { config } from "./config";
import { sanitizeAssistantResponseForAudio } from "./responseSanitizer";
import {
  createBackgroundSession,
  listBackgroundSessions
} from "./sessionManager";

const actionPattern =
  /\b(add|build|create|draft|fix|implement|make|publish|refactor|run|set up|start|test|update|write)\b/i;
const statusPattern = /\b(status|progress|running|workers?|sessions?|finished|blocked|done)\b/i;
const explicitDelegatePattern =
  /\b(background|delegate|hand off|kick off|let that run|start a session|start the next step|worker)\b/i;
const conversationalPattern = /\b(why|how|what do you think|brainstorm|talk through|explain)\b/i;
const planningPattern =
  /\b(plan|planning|architect|architecture|strategy|roadmap|scope|spec|requirements|proposal|approach|design)\b/i;
const answerPattern =
  /\b(answer|answers|for now|the goal is|audience|constraint|deadline|priority|success|budget|scope)\b/i;

function codexCommand() {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function createMessage(role: ConversationMessage["role"], content: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  };
}

function titleFromTranscript(transcript: string) {
  const words = transcript
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  const title = words.join(" ");
  return title ? title[0].toUpperCase() + title.slice(1) : "Voice worker";
}

function sessionMode(settings: AssistantSettings): BackgroundSessionMode {
  return settings.codexMode === "plan" ? "plan" : "execute";
}

function formatStatusSummary(sessions: BackgroundSession[]) {
  if (!sessions.length) {
    return {
      fullAnswer: "No worker sessions are active yet. We can keep planning, or you can ask me to start a background task.",
      spokenSummary: "No worker sessions are active yet."
    };
  }

  const running = sessions.filter((session) => session.status === "running" || session.status === "queued");
  const blocked = sessions.filter((session) => session.status === "blocked" || session.status === "failed");
  const done = sessions.filter((session) => session.status === "done");
  const latest = sessions[0];
  const fullAnswer = [
    `Workers: ${running.length} running, ${blocked.length} blocked or failed, ${done.length} done.`,
    latest
      ? `Latest: ${latest.title} is ${latest.status}. ${latest.report.summary || "No summary yet."}`
      : "",
    blocked.length
      ? `Needs attention: ${blocked.map((session) => `${session.title}: ${session.report.blockers}`).join("; ")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    fullAnswer,
    spokenSummary:
      running.length > 0
        ? `${running.length} worker session${running.length === 1 ? " is" : "s are"} still running. Latest: ${latest.title} is ${latest.status}.`
        : `No workers are running. Latest: ${latest.title} is ${latest.status}.`
  };
}

function shouldDelegate(transcript: string) {
  if (explicitDelegatePattern.test(transcript)) return true;
  if (conversationalPattern.test(transcript) && !actionPattern.test(transcript)) return false;
  return actionPattern.test(transcript);
}

function planningTopic(transcript: string) {
  const clean = transcript.replace(/\s+/g, " ").trim();
  const words = clean.split(/\s+/).slice(0, 10).join(" ");
  return words || "Planning topic";
}

export function planningQuestionsFor(transcript: string): PlannerQuestion[] {
  const lower = transcript.toLowerCase();
  const questions: PlannerQuestion[] = [
    {
      id: "goal",
      label: "Goal",
      question: "What outcome are we trying to create, and what would make this feel successful?",
      why: "The planner needs a success target before choosing execution steps."
    },
    {
      id: "scope",
      label: "Scope",
      question: "What should be included now, and what should explicitly wait for later?",
      why: "Clear boundaries keep workers from doing too much or solving the wrong problem."
    },
    {
      id: "constraints",
      label: "Constraints",
      question: "Are there constraints around tools, budget, timing, risk, brand, or approval?",
      why: "Constraints help the agent decide when to act, ask, or stay in plan mode."
    }
  ];

  if (/\b(user|customer|client|audience|buyer)\b/i.test(lower)) {
    questions.splice(1, 0, {
      id: "audience",
      label: "Audience",
      question: "Who is this for, and what do they already know or need from us?",
      why: "Audience context changes the tone, priorities, and deliverables."
    });
  }

  if (/\b(app|interface|ui|ux|voice|chat)\b/i.test(lower)) {
    questions.splice(2, 0, {
      id: "workflow",
      label: "Workflow",
      question: "What is the ideal user flow from first trigger to completed task?",
      why: "Workflow details help the planner translate the idea into product behavior."
    });
  }

  return questions.slice(0, 4);
}

function shouldAskPlanningQuestions(
  transcript: string,
  history: ConversationMessage[],
  settings: AssistantSettings
) {
  if (answerPattern.test(transcript)) return false;
  if (conversationalPattern.test(transcript) && !actionPattern.test(transcript)) return false;
  if (history.slice(-4).some((message) => message.content.includes("Planning questions"))) {
    return false;
  }
  if (settings.codexMode === "plan" && actionPattern.test(transcript)) return true;
  return planningPattern.test(transcript) && !explicitDelegatePattern.test(transcript);
}

function createPlannerPrompt(transcript: string): PlannerPrompt {
  return {
    topic: planningTopic(transcript),
    status: "needs-input",
    questions: planningQuestionsFor(transcript)
  };
}

function formatPlannerQuestions(prompt: PlannerPrompt) {
  return [
    `Planning questions for: ${prompt.topic}`,
    "",
    ...prompt.questions.map((question, index) => `${index + 1}. ${question.question}`)
  ].join("\n");
}

function workerPrompt(transcript: string, history: ConversationMessage[], settings: AssistantSettings) {
  const recentContext = history
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  return [
    "You are a worker session started by the main voice planning agent.",
    "Focus only on the task below. Keep edits bounded and report clearly.",
    settings.codexMode === "plan"
      ? "This worker is read-only planning mode."
      : "This worker may execute changes in the local project.",
    "Recent planning context:",
    recentContext || "(none)",
    "Worker task:",
    transcript
  ].join("\n\n");
}

function formatHistory(history: ConversationMessage[]) {
  return history
    .slice(-10)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

function extractCodexAnswer(stdout: string) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const markerIndex = lines.lastIndexOf("codex");
  if (markerIndex >= 0 && lines[markerIndex + 1]) {
    const endIndex = lines.findIndex((line, index) => index > markerIndex && line === "tokens used");
    return lines.slice(markerIndex + 1, endIndex > markerIndex ? endIndex : undefined).join("\n");
  }
  return stdout.trim();
}

function runPlannerResponse(prompt: string) {
  return new Promise<string>((resolve, reject) => {
    const outputDir = path.join(process.cwd(), "work", "planner-runs");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(
      outputDir,
      `${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
    );
    const child: ChildProcessWithoutNullStreams = spawn(
      codexCommand(),
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-last-message",
        outputFile,
        "--cd",
        config.CODEX_WORKDIR,
        "-"
      ],
      {
        cwd: config.CODEX_WORKDIR,
        shell: process.platform === "win32",
        windowsHide: true
      }
    );

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("The planning response timed out."));
    }, 1000 * 60 * 3);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (code && code !== 0) {
        reject(new Error(combined || `Planner response exited with code ${code}.`));
        return;
      }
      const lastMessage = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf8").trim()
        : "";
      fs.rmSync(outputFile, { force: true });
      resolve(lastMessage || extractCodexAnswer(combined));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function createMainPlannerAnswer(input: {
  transcript: string;
  history: ConversationMessage[];
  settings: AssistantSettings;
  delegatedTitle?: string;
  delegatedMode?: BackgroundSessionMode;
}) {
  if (process.env.VITEST) {
    return input.delegatedTitle
      ? `Here is my take on your request before execution. I also started a worker for ${input.delegatedTitle}.`
      : "Here is my take on your request. I am keeping this in the main planning session so we can think it through.";
  }

  const prompt = [
    "You are the main voice planning agent in a local command center.",
    "Respond conversationally to the user's actual prompt first. Do not ignore nuance.",
    "Your job is to reason with the user, brainstorm, research from available local context if helpful, and manage work.",
    "Do not make edits or run implementation. Concrete execution is handled by background workers.",
    "Return a useful spoken-friendly answer in 2-6 short paragraphs.",
    "If a worker was started, mention it after answering the substance, not instead of answering.",
    `Assistant style: ${input.settings.assistantStyle}`,
    input.delegatedTitle
      ? `A background ${input.delegatedMode} worker was started: ${input.delegatedTitle}.`
      : "No background worker was started for this turn.",
    "Recent conversation:",
    formatHistory(input.history) || "(none yet)",
    "User said:",
    input.transcript
  ].join("\n\n");

  try {
    return (await runPlannerResponse(prompt)).trim();
  } catch (error) {
    const fallback = input.delegatedTitle
      ? `I started a background worker for ${input.delegatedTitle}, and I’ll keep the main session open so we can keep shaping the idea.`
      : "I’m keeping this in the main planning session so we can talk it through before handing off execution.";
    console.error(`[${new Date().toISOString()}] planner response failed`, error);
    return fallback;
  }
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function trimToWords(text: string, maxWords: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}.`;
}

export function spokenSummaryFrom(answer: string, settings: AssistantSettings, delegatedTitle?: string) {
  const clean = sanitizeAssistantResponseForAudio(answer).replace(/\s+/g, " ").trim();
  if (!clean) return delegatedTitle ? `I started ${delegatedTitle} in the background.` : "";

  const targetWords = Math.max(25, Math.min(settings.summaryWords, 70));
  if (countWords(clean) <= targetWords + 8) {
    return clean;
  }

  const sentences = clean.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) ?? [clean];
  const selected: string[] = [];

  const addSentence = (sentence?: string) => {
    if (!sentence || selected.includes(sentence)) return;
    selected.push(sentence);
  };

  addSentence(sentences[0]);
  addSentence(
    sentences.find((sentence) =>
      /\b(background worker|worker was started|started a worker|started|delegated|running|blocked|done)\b/i.test(sentence)
    ) ??
      sentences.find((sentence) =>
        /\b(worker|background|session)\b/i.test(sentence)
      )
  );
  addSentence(
    [...sentences]
      .reverse()
      .find((sentence) => /\b(next|so|means|recommend|would|should|can|keep|resume)\b/i.test(sentence))
  );

  for (const sentence of sentences) {
    if (countWords(selected.join(" ")) >= targetWords) break;
    addSentence(sentence);
  }

  const balanced = selected.join(" ").trim();
  if (delegatedTitle && !clean.toLowerCase().includes("worker")) {
    return trimToWords(`${balanced || clean} I also started ${delegatedTitle} in the background.`, targetWords + 12);
  }
  return trimToWords(balanced || clean, targetWords + 8);
}

export async function handlePlannerTurn(
  transcript: string,
  history: ConversationMessage[],
  settings: AssistantSettings
): Promise<TextTurnResponse> {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) {
    throw new Error("I did not catch any words. Try again.");
  }

  const userMessage = createMessage("user", cleanTranscript);
  const sessions = listBackgroundSessions();

  if (
    statusPattern.test(cleanTranscript) &&
    !actionPattern.test(cleanTranscript) &&
    !answerPattern.test(cleanTranscript)
  ) {
    const status = formatStatusSummary(sessions);
    return {
      userMessage,
      assistantMessage: createMessage("assistant", status.fullAnswer),
      spokenSummary: status.spokenSummary,
      settings
    };
  }

  if (shouldAskPlanningQuestions(cleanTranscript, history, settings)) {
    const plannerPrompt = createPlannerPrompt(cleanTranscript);
    const fullAnswer = [
      "I can plan this, but I want to lock the shape before starting workers.",
      formatPlannerQuestions(plannerPrompt),
      "",
      "Answer these naturally in one message. I will turn the answers into a plan or hand off bounded worker sessions after that."
    ].join("\n\n");

    return {
      userMessage,
      assistantMessage: createMessage("assistant", fullAnswer),
      spokenSummary: `I need a few planning answers first. ${plannerPrompt.questions
        .slice(0, 2)
        .map((question) => question.question)
        .join(" ")}`,
      settings,
      plannerPrompt
    };
  }

  if (shouldDelegate(cleanTranscript)) {
    const session = createBackgroundSession({
      title: titleFromTranscript(cleanTranscript),
      mode: sessionMode(settings),
      prompt: workerPrompt(cleanTranscript, history, settings)
    });
    const fullAnswer = await createMainPlannerAnswer({
      transcript: cleanTranscript,
      history,
      settings,
      delegatedTitle: session.title,
      delegatedMode: session.mode
    });

    return {
      userMessage,
      assistantMessage: createMessage("assistant", fullAnswer),
      spokenSummary: spokenSummaryFrom(fullAnswer, settings, session.title),
      settings
    };
  }

  const fullAnswer = await createMainPlannerAnswer({
    transcript: cleanTranscript,
    history,
    settings
  });

  return {
    userMessage,
    assistantMessage: createMessage("assistant", fullAnswer),
    spokenSummary: spokenSummaryFrom(fullAnswer, settings),
    settings
  };
}
