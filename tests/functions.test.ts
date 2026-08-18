import { describe, expect, it } from "vitest";
import locations from "../netlify/functions/locations";
import route from "../netlify/functions/route";
import sites from "../netlify/functions/sites";

describe("address function entry points", () => {
  it("loads the location, route, and site handlers", () => {
    expect(locations).toBeTypeOf("function");
    expect(route).toBeTypeOf("function");
    expect(sites).toBeTypeOf("function");
  });
});
