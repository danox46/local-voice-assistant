import { describe, expect, it } from "vitest";

import { sanitizeAssistantResponseForAudio } from "./responseSanitizer";

describe("sanitizeAssistantResponseForAudio", () => {
  it("keeps markdown file labels and removes full local paths", () => {
    const text =
      "Added [danny-remoto-experiment-publish-pack.md](C:/Users/danox/Documents/Codex/project/outputs/local-voice-assistant/work/danny-remoto-experiment-publish-pack.md).";

    expect(sanitizeAssistantResponseForAudio(text)).toBe(
      "Added danny-remoto-experiment-publish-pack.md.",
    );
  });

  it("replaces bare Windows paths with file names", () => {
    const text =
      "Updated C:\\Users\\danox\\Documents\\Codex\\project\\outputs\\local-voice-assistant\\work\\notes.md for review.";

    expect(sanitizeAssistantResponseForAudio(text)).toBe(
      "Updated notes.md for review.",
    );
  });

  it("replaces bare absolute POSIX paths with file names", () => {
    const text = "See /tmp/local-voice-assistant/work/summary.md when ready.";

    expect(sanitizeAssistantResponseForAudio(text)).toBe(
      "See summary.md when ready.",
    );
  });
});
