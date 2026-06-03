import { beforeEach, describe, expect, it } from "vitest";
import { listActivityEvents, recordActivity, resetActivityEvents } from "./activityFeed";

describe("activityFeed", () => {
  beforeEach(() => {
    resetActivityEvents();
  });

  it("keeps newest activity first", () => {
    recordActivity({ kind: "system", title: "First", detail: "Old event." });
    recordActivity({ kind: "mode", title: "Second", detail: "New event." });

    const events = listActivityEvents();

    expect(events[0].title).toBe("Second");
    expect(events[1].title).toBe("First");
  });

  it("caps the feed to the most recent events", () => {
    for (let index = 0; index < 90; index += 1) {
      recordActivity({ kind: "worker", title: `Event ${index}`, detail: "Worker update." });
    }

    const events = listActivityEvents();

    expect(events).toHaveLength(80);
    expect(events[0].title).toBe("Event 89");
    expect(events.at(-1)?.title).toBe("Event 10");
  });
});
