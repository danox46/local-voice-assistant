import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LocalSpeechAudio {
  audioMimeType: "audio/wav";
  audioBase64: string;
}

export async function synthesizeLocalSpeech(text: string): Promise<LocalSpeechAudio> {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText) {
    throw new Error("There is no text to read out loud.");
  }
  if (process.platform !== "win32") {
    throw new Error("Local system voice is currently available on Windows only.");
  }

  const id = crypto.randomUUID();
  const dir = path.join(os.tmpdir(), "local-voice-assistant-tts");
  const textPath = path.join(dir, `${id}.txt`);
  const audioPath = path.join(dir, `${id}.wav`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(textPath, cleanText.slice(0, 4000), "utf8");

  const safeTextPath = textPath.replace(/'/g, "''");
  const safeAudioPath = audioPath.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Speech",
    `$text = Get-Content -Raw -LiteralPath '${safeTextPath}'`,
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$synth.Rate = 0",
    "$synth.Volume = 100",
    `$synth.SetOutputToWaveFile('${safeAudioPath}')`,
    "$synth.Speak($text)",
    "$synth.Dispose()"
  ].join("; ");

  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 30000,
      windowsHide: true
    });
    const audio = await fs.readFile(audioPath);
    return {
      audioMimeType: "audio/wav",
      audioBase64: audio.toString("base64")
    };
  } finally {
    await Promise.allSettled([fs.unlink(textPath), fs.unlink(audioPath)]);
  }
}

export async function speakLocalSpeech(text: string): Promise<void> {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText) {
    throw new Error("There is no text to read out loud.");
  }
  if (process.platform !== "win32") {
    throw new Error("Local system voice is currently available on Windows only.");
  }

  const id = crypto.randomUUID();
  const dir = path.join(os.tmpdir(), "local-voice-assistant-tts");
  const textPath = path.join(dir, `${id}.txt`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(textPath, cleanText.slice(0, 4000), "utf8");

  const safeTextPath = textPath.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Speech",
    `$text = Get-Content -Raw -LiteralPath '${safeTextPath}'`,
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$synth.Rate = 0",
    "$synth.Volume = 100",
    "$synth.SetOutputToDefaultAudioDevice()",
    "$synth.Speak($text)",
    "$synth.Dispose()"
  ].join("; ");

  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 30000,
      windowsHide: true
    });
  } finally {
    await Promise.allSettled([fs.unlink(textPath)]);
  }
}
