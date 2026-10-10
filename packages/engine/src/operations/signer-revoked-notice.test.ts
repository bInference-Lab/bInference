import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { signerRevokedKey } from "./signer-revoked-notice.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });

describe("the signer revoked notice", () => {
  it("names the signer and the surface, and says to freeze", () => {
    expect(english.message(signerRevokedKey, { signer: "quorum-1", surface: "cli" })).toBe(
      "⚠️ The owner key removed the agent key of signer quorum-1 from every wallet, from the CLI. The machine that held it signs nothing more. Not you? Freeze now.",
    );
  });
});
