import { describe, expect, it } from "vitest";
import { checkProtocolVersion, protocolVersion } from "./protocol-version.js";

describe("checkProtocolVersion", () => {
  it("serves the current version", () => {
    expect(checkProtocolVersion(protocolVersion)).toStrictEqual({ ok: true, value: 1 });
  });

  it.each([protocolVersion + 1, 0, -1, 1.5])("refuses version %d", (version) => {
    expect(checkProtocolVersion(version)).toStrictEqual({ ok: false, error: "protocol.version" });
  });
});
