import { createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { selfHostedRiskSources } from "./risk-sources.js";

describe("self-hosted risk sources", () => {
  it("needs a report from GoPlus and takes the honeypot source as a second opinion", () => {
    const sources = selfHostedRiskSources(createScriptedHttp([]));
    expect(sources.map(({ source, isRequired }) => [source.id, isRequired])).toStrictEqual([
      ["goplus", true],
      ["honeypot", false],
    ]);
  });
});
