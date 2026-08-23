import { describe, expect, it } from "vitest";
import { findDispatchConflicts } from "../src/dispatch-planning";

describe("dispatch capacity conflicts", () => {
  it("flags overlapping jobs for the same dispatcher", () => {
    const ids = findDispatchConflicts([
      { id: "a", status: "approved", date: "2026-08-23", time: "09:00", assignedTo: "Brent", durationMinutes: 90 },
      { id: "b", status: "approved", date: "2026-08-23", time: "10:00", assignedTo: "Brent", durationMinutes: 45 },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("does not flag different dispatchers or back-to-back jobs", () => {
    const ids = findDispatchConflicts([
      { id: "a", status: "approved", date: "2026-08-23", time: "09:00", assignedTo: "Brent", durationMinutes: 60 },
      { id: "b", status: "approved", date: "2026-08-23", time: "10:00", assignedTo: "Brent", durationMinutes: 60 },
      { id: "c", status: "approved", date: "2026-08-23", time: "09:30", assignedTo: "Alex", durationMinutes: 60 },
    ]);
    expect([...ids]).toEqual([]);
  });
});
