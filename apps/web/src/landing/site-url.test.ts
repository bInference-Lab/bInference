import { afterEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "./site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("uses the production domain Vercel gives a build there", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "agent.example.com");
    expect(siteUrl().href).toBe("https://agent.example.com/");
  });

  it("falls back to the local server outside Vercel", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(siteUrl().href).toBe("http://localhost:4819/");
  });
});
