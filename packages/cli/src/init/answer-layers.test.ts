import { describe, expect, it } from "vitest";
import { type InitFlags, initFlagsSchema } from "../program/cli-flags.schema.js";
import { layeredAnswers } from "./answer-layers.js";
import { answerNames } from "./answer-names.js";

function flagsOf(given: Readonly<Record<string, unknown>> = {}): InitFlags {
  return initFlagsSchema.parse({ yes: true, ...given });
}

describe("init's answer layers", () => {
  it("names each answer's flag and variable after the flag", () => {
    const appId = answerNames.find((answer) => answer.key === "privyAppId");
    expect(appId).toMatchObject({
      flag: "--privy-app-id",
      variable: "BINFERENCE_INIT_PRIVY_APP_ID",
    });
  });

  it("takes a flag over its variable, and keeps where each answer came from", () => {
    const env = { BINFERENCE_INIT_PRIVY_APP_ID: "from-variable", BINFERENCE_INIT_RESCUE: "0xvar" };

    const layered = layeredAnswers(flagsOf({ privyAppId: "from-flag" }), env);

    expect(layered).toMatchObject({
      ok: true,
      value: {
        flags: { privyAppId: "from-flag", rescue: "0xvar" },
        origins: new Map([
          ["privyAppId", { layer: "flag" }],
          ["rescue", { layer: "variable", name: "BINFERENCE_INIT_RESCUE" }],
        ]),
      },
    });
  });

  it("reads a variable's switch, and leaves out an empty variable", () => {
    const env = { BINFERENCE_INIT_ACCEPT_DISCLAIMER: "1", BINFERENCE_INIT_RESCUE: "" };

    const layered = layeredAnswers(flagsOf(), env);

    expect(layered).toMatchObject({ ok: true, value: { flags: { acceptDisclaimer: true } } });
    expect(layered).not.toHaveProperty(["value", "flags", "rescue"]);
  });

  it("refuses a variable with the prefix that answers nothing", () => {
    const env = { BINFERENCE_INIT_PRIVY_APPID: "x" };

    expect(layeredAnswers(flagsOf(), env)).toStrictEqual({
      ok: false,
      refusal: {
        code: "init.unknown_variable",
        key: "refused.unknownVariable",
        values: { variable: "BINFERENCE_INIT_PRIVY_APPID" },
      },
    });
  });

  it("names a bad answer by its variable, never by its value", () => {
    const env = { BINFERENCE_INIT_ACCEPT_DISCLAIMER: "maybe", BINFERENCE_INIT_UNLOCK: "vault" };

    const layered = layeredAnswers(flagsOf(), env);

    expect(layered).toMatchObject({
      refusal: { code: "init.bad_answer", values: { name: "BINFERENCE_INIT_ACCEPT_DISCLAIMER" } },
    });
    expect(JSON.stringify(layered)).not.toMatch(/maybe|vault/u);
  });
});
