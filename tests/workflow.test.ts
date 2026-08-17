import { describe, expect, it } from "vitest";
import { canTransition } from "../netlify/functions/_shared/workflow";

describe("booking status workflow", () => {
  it("allows only the expected dispatcher path", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("approved", "in-progress")).toBe(true);
    expect(canTransition("in-progress", "completed")).toBe(true);
  });

  it("blocks skipped and terminal-state transitions", () => {
    expect(canTransition("pending", "completed")).toBe(false);
    expect(canTransition("completed", "pending")).toBe(false);
    expect(canTransition("declined", "approved")).toBe(false);
  });
});
