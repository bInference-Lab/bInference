import { format, inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { BinferenceError } from "../errors/binference-error.js";
import { createSecret, secretMark } from "./secret.js";

const value = "7012345678:AAH-exampleBotTokenThatMustStayHidden";

describe("secret", () => {
  it("reveals its value only through reveal", () => {
    expect(createSecret(value).reveal()).toBe(value);
  });

  it("shows the mark as text, in a template, as JSON and when inspected", () => {
    const secret = createSecret(value);
    const shown = [
      String(secret),
      // oxlint-disable-next-line typescript/restrict-template-expressions -- a template must show the mark
      `${secret}`,
      JSON.stringify({ token: secret }),
      inspect({ token: secret }, { depth: null, showHidden: true }),
      format("%s %o %j", secret, secret, secret),
    ];
    expect(shown.join("\n")).not.toContain(value);
    expect(shown[0]).toBe(secretMark);
  });

  it("keeps the value out of its keys, a spread and an error's details", () => {
    const secret = createSecret(value);
    const error = new BinferenceError({
      code: "config.secret_unavailable",
      message: `token ${String(secret)}`,
      details: { token: String(secret) },
    });
    expect(JSON.stringify({ ...secret })).not.toContain(value);
    expect(Object.values(secret).join()).not.toContain(value);
    expect(inspect(error, { depth: null })).not.toContain(value);
  });

  it("cannot be changed", () => {
    const secret = createSecret(value);
    expect(Object.isFrozen(secret)).toBe(true);
  });
});
