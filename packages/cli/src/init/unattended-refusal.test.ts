import { describe, expect, it } from "vitest";
import { unattendedRefusal } from "./unattended-refusal.js";

const source = '{ fromEnv: "SECRET" }';
const named = (flag: string): string => `named ${flag}`;

// Every answer a new set-up needs with nobody at the terminal, the model at OpenAI's API.
const complete = {
  modelProvider: "openai",
  model: "gpt-test",
  modelKey: source,
  privyAppId: "app",
  privyAppSecret: source,
  ownerKeyPublic: "MFkw",
  rescue: "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB",
  botToken: source,
};

describe("a set-up nobody answers", () => {
  it("passes once every answer is there", () => {
    expect(unattendedRefusal(complete, named)).toBeUndefined();
  });

  it("names the first answer missing, in the order of the onboarding", () => {
    const { privyAppId: _appId, rescue: _rescue, ...rest } = complete;

    expect(unattendedRefusal(rest, named)).toStrictEqual({
      code: "init.needs_flag",
      key: "refused.needsAnswer",
      values: {
        flag: "--privy-app-id",
        variable: "BINFERENCE_INIT_PRIVY_APP_ID",
        key: "privyAppId",
      },
    });
  });

  it("needs the program that prints the agent key in the command mode", () => {
    expect(unattendedRefusal({ ...complete, unlock: "command" }, named)).toMatchObject({
      values: { flag: "--unlock-command" },
    });
  });

  it("refuses an inline secret before it names a missing answer", () => {
    const { rescue: _rescue, ...rest } = complete;

    const refusal = unattendedRefusal({ ...rest, botToken: "123456:AAE-token" }, named);

    expect(refusal).toStrictEqual({
      code: "config.secret_inline",
      key: "refused.secretInline",
      values: { name: "named --bot-token", example: '{ fromEnv: "BOT_TOKEN" }' },
    });
  });
});
