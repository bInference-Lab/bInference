import { describe, expect, it } from "vitest";
import { protocolErrorCodes } from "../errors/protocol-error-codes.js";
import { protocolVersion } from "../versions/protocol-version.js";
import { describeProtocol } from "./describe-protocol.js";

describe("describeProtocol", () => {
  it("converts every frame, the error codes and the id prefixes to JSON Schema", () => {
    const description = describeProtocol();
    expect(description.version).toBe(protocolVersion);
    expect(Object.keys(description.schemas)).toStrictEqual([
      "frame/open",
      "frame/challenge",
      "frame/prove",
      "frame/ready",
      "frame/call",
      "frame/reply",
      "frame/fail",
      "frame/push",
      "frame/bye",
      "error/codes",
      "id/prefixes",
    ]);
    expect(description.schemas["error/codes"]?.enum).toStrictEqual([...protocolErrorCodes]);
  });

  it("describes the wire form, where optional fields are absent", () => {
    expect(describeProtocol().schemas["frame/call"]).toMatchObject({
      type: "object",
      required: ["t", "id", "op", "args"],
      properties: { key: { type: "string", maxLength: 64 } },
    });
  });
});
