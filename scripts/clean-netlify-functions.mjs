import { rm } from "node:fs/promises";
import { resolve } from "node:path";

// Netlify may restore generated function bundles from its build cache. Clear only
// that generated directory so removed functions cannot survive a later deploy.
const generatedFunctions = resolve(process.cwd(), ".netlify", "functions");
await rm(generatedFunctions, { recursive: true, force: true });
