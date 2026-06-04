import { describe, expect, it } from "vitest";
import { isRepeatLastResponseCommand, isRetryLastTurnCommand } from "./voiceCommandCatalog";

describe("voice command catalog helpers", () => {
  it("detects retry commands without matching ordinary planning text", () => {
    expect(isRetryLastTurnCommand("retry last turn")).toBe(true);
    expect(isRetryLastTurnCommand("try that again")).toBe(true);
    expect(isRetryLastTurnCommand("retry the deployment later")).toBe(false);
  });

  it("detects repeat response commands without matching retry commands", () => {
    expect(isRepeatLastResponseCommand("repeat last response")).toBe(true);
    expect(isRepeatLastResponseCommand("read that again")).toBe(true);
    expect(isRepeatLastResponseCommand("retry last turn")).toBe(false);
  });
});
