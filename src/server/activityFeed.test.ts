import { beforeEach, describe, expect, it, vi } from "vitest";

describe("activityFeed", () => {
  beforeEach(async () => {
    const { resetActivityEvents } = await import("./activityFeed");
    resetActivityEvents();
  });

  it("keeps newest activity first", async () => {
    const { listActivityEvents, recordActivity } = await import("./activityFeed");

    recordActivity({ kind: "system", title: "First", detail: "Old event." });
    recordActivity({ kind: "mode", title: "Second", detail: "New event." });

    const events = listActivityEvents();

    expect(events[0].title).toBe("Second");
    expect(events[1].title).toBe("First");
  });

  it("caps the feed to the most recent events", async () => {
    const { listActivityEvents, recordActivity } = await import("./activityFeed");

    for (let index = 0; index < 90; index += 1) {
      recordActivity({ kind: "worker", title: `Event ${index}`, detail: "Worker update." });
    }

    const events = listActivityEvents();

    expect(events).toHaveLength(80);
    expect(events[0].title).toBe("Event 89");
    expect(events.at(-1)?.title).toBe("Event 10");
  });

  it("reloads activity from disk after module cache reset", async () => {
    const firstModule = await import("./activityFeed");
    firstModule.recordActivity({ kind: "focus", title: "Focused worker", detail: "A worker was focused." });

    vi.resetModules();
    const secondModule = await import("./activityFeed");

    expect(secondModule.listActivityEvents()[0].title).toBe("Focused worker");
    secondModule.resetActivityEvents();
  });
});
