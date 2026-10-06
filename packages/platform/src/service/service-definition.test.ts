import { describe, expect, it } from "vitest";
import { checkServiceDefinition, type ServiceDefinition } from "./service-definition.js";

const engine: ServiceDefinition = {
  name: "engine",
  description: "binference engine",
  program: "/usr/bin/node",
  args: ["/srv/binference/engine.mjs"],
  workingFolder: "/srv/binference",
  logFile: "/srv/binference/logs/service.log",
  stopTimeoutMs: 30_000,
};

describe("service definition", () => {
  it("takes a definition with a name, absolute paths and a stop timeout in range", () => {
    expect(() => checkServiceDefinition(engine)).not.toThrow();
  });

  it.each([
    ["a name with capitals", { name: "Engine" }],
    ["a name of 41 characters", { name: `e${"x".repeat(40)}` }],
    ["a relative log file", { logFile: "logs/service.log" }],
    ["a line break in an argument", { args: ["--label", "two\nlines"] }],
    ["a NUL in the description", { description: "engine\0" }],
    ["a stop timeout under 1 s", { stopTimeoutMs: 999 }],
    ["a stop timeout over 120 s", { stopTimeoutMs: 120_001 }],
    ["a stop timeout of part of a millisecond", { stopTimeoutMs: 1000.5 }],
  ])("refuses %s", (_case, change) => {
    expect(() => checkServiceDefinition({ ...engine, ...change })).toThrow(
      expect.objectContaining({ code: "platform.service_definition_invalid" }),
    );
  });
});
