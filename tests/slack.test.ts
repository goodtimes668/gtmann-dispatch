import { describe, expect, it } from "vitest";
import { requesterArrivalText } from "../netlify/functions/_shared/slack";

describe("Slack requester arrival notifications", () => {
  it("creates a clear ten-minute material-delivery message", () => {
    expect(requesterArrivalText({ type: "delivery", site: "Grand & Fir" }))
      .toBe("Your material delivery to Grand & Fir is approximately 10 minutes away.");
  });

  it("supports tool deliveries", () => {
    expect(requesterArrivalText({ type: "tool-delivery", site: "Lampson" }))
      .toBe("Your tool delivery to Lampson is approximately 10 minutes away.");
  });
});
