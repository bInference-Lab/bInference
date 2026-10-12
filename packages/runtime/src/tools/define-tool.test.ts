import { decimalStringSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PreparedCall, ToolRunContext } from "../loop/turn-records.js";
import { cutResult, defineTool, maxResultChars, type ToolSpec } from "./define-tool.js";

const context: ToolRunContext = { signal: new AbortController().signal, idempotencyKey: "k" };

interface SwapArgs {
  readonly amountBase: bigint;
  readonly reason: string;
}

const seen: SwapArgs[] = [];

const swapSpec: ToolSpec<SwapArgs> = {
  name: "swap",
  kind: "propose",
  description: "Swap one token for another.",
  args: z.strictObject({ amountBase: decimalStringSchema, reason: z.string().min(1) }),
  run: async (args) => {
    seen.push(args);
    return { text: `swapping ${args.amountBase.toString()}`, isError: false };
  },
};

async function noText(): Promise<{ readonly text: string; readonly isError: boolean }> {
  return { text: "", isError: false };
}

async function runPrepared(prepared: PreparedCall): Promise<string> {
  return prepared.ready ? (await prepared.run(context)).text : `refused: ${prepared.text}`;
}

describe("defineTool", () => {
  it("shows the model the schema of what it writes, money as a decimal string", () => {
    const { declaration } = defineTool(swapSpec);
    expect(declaration).toMatchObject({
      name: "swap",
      description: "Swap one token for another.",
      parameters: {
        type: "object",
        properties: { amountBase: { type: "string" }, reason: { type: "string" } },
        required: ["amountBase", "reason"],
        additionalProperties: false,
      },
    });
  });

  it("runs a call with its parsed arguments, an amount past 2^53 exact", async () => {
    const prepared = defineTool(swapSpec).prepare(
      '{"amountBase":123456789012345678901,"reason":"rebalance"}',
    );
    await expect(runPrepared(prepared)).resolves.toBe("swapping 123456789012345678901");
    expect(seen.at(-1)).toStrictEqual({ amountBase: 123456789012345678901n, reason: "rebalance" });
  });

  it.each([
    ["an amount written as a number", '{"amountBase":1500,"reason":"r"}', "amountBase"],
    ["an amount with a fraction", '{"amountBase":"1.5","reason":"r"}', "amountBase"],
    ["a missing reason", '{"amountBase":"1"}', "reason"],
    [
      "a field the schema does not name",
      '{"amountBase":"1","reason":"r","wallet":"0x1"}',
      "wallet",
    ],
  ])("refuses %s with the schema's issue, without coercing it", async (_case, text, field) => {
    const prepared = defineTool(swapSpec).prepare(text);
    expect(prepared.ready).toBe(false);
    await expect(runPrepared(prepared)).resolves.toContain(field);
    await expect(runPrepared(prepared)).resolves.toContain(
      "not run: the arguments do not match swap's schema",
    );
  });

  it("refuses arguments that are not JSON", async () => {
    await expect(runPrepared(defineTool(swapSpec).prepare("{amountBase:"))).resolves.toBe(
      "refused: not run: the arguments of swap are not valid JSON",
    );
  });

  it.each([
    [
      `{"amountBase":"1","reason":${"[".repeat(2_000)}${"]".repeat(2_000)}}`,
      "nested deeper than 64 levels",
    ],
    ['{"amountBase":"1","amountBase":"2","reason":"r"}', "name a field twice"],
    ['{"amountBase":1e21,"reason":"r"}', "write amounts as decimal strings"],
    [`{"reason":"${"x".repeat(70_000)}"}`, "longer than 65536 characters"],
  ])("refuses arguments it cannot read safely, saying why", async (text, why) => {
    const prepared = defineTool(swapSpec).prepare(text);
    await expect(runPrepared(prepared)).resolves.toContain(why);
  });

  it("refuses a call whose schema check throws, never throwing itself", async () => {
    const throwing = defineTool({
      ...swapSpec,
      args: z.strictObject({
        amountBase: decimalStringSchema,
        reason: z.string().refine(() => {
          throw new Error("a check that throws");
        }),
      }),
    });
    await expect(runPrepared(throwing.prepare('{"amountBase":"1","reason":"r"}'))).resolves.toBe(
      "refused: not run: the arguments of swap could not be read",
    );
  });

  it("takes strict objects, records, lists, options and codecs that never coerce", () => {
    const args = z.strictObject({
      amountBase: decimalStringSchema,
      legs: z.array(z.strictObject({ to: z.string(), bps: z.int().optional() })),
      labels: z.record(z.string(), z.string()),
      side: z.enum(["buy", "sell"]),
    });
    expect(
      defineTool({ name: "plan", kind: "read", description: "Plan.", args, run: noText }).name,
    ).toBe("plan");
  });

  it("lets only a read run beside others, and carries the outside-content flag", () => {
    const empty = z.strictObject({});
    const read = defineTool({
      name: "search_web",
      kind: "read",
      description: "Search.",
      args: empty,
      parallel: true,
      outside: true,
      run: noText,
    });
    const control = defineTool({
      name: "alert_create",
      kind: "control",
      description: "Alert.",
      args: empty,
      parallel: true,
      run: noText,
    });
    expect(read.prepare("{}")).toMatchObject({
      ready: true,
      kind: "read",
      parallel: true,
      outside: true,
    });
    expect(control.prepare("")).toMatchObject({
      ready: true,
      kind: "control",
      parallel: false,
      outside: false,
      asksOwner: false,
    });
  });

  it("carries that a control tool asks the owner", () => {
    const ask = defineTool({
      name: "ask_owner",
      kind: "control",
      description: "Ask the owner.",
      args: z.strictObject({}),
      asksOwner: true,
      run: noText,
    });
    expect(ask.prepare("{}")).toMatchObject({ ready: true, kind: "control", asksOwner: true });
  });

  it("cuts a long result and says how much was cut", async () => {
    const long = defineTool({
      name: "read_page",
      kind: "read",
      description: "Read a page.",
      args: z.strictObject({}),
      run: async () => ({ text: "a".repeat(maxResultChars + 500), isError: false }),
    });
    const text = await runPrepared(long.prepare("{}"));
    expect(text).toBe(`${"a".repeat(maxResultChars)}\n[cut: 500 more characters]`);
  });

  it("never cuts a character in half", () => {
    // A character outside the Basic Multilingual Plane takes two UTF-16 units.
    const text = `${"a".repeat(maxResultChars - 1)}${String.fromCodePoint(0x1d11e)}tail`;
    expect(cutResult(text)).toBe(`${"a".repeat(maxResultChars - 1)}\n[cut: 6 more characters]`);
  });

  it.each([
    ["a name that is not lowercase words", { ...swapSpec, name: "Swap Now" }],
    ["arguments that are not an object", { ...swapSpec, args: z.string() }],
    ["a question for the owner on a tool that is not control", { ...swapSpec, asksOwner: true }],
    [
      "an object that allows fields it does not name",
      { ...swapSpec, args: z.object({ reason: z.string() }) },
    ],
    [
      "a nested object that allows fields it does not name",
      { ...swapSpec, args: z.strictObject({ leg: z.object({ to: z.string() }) }) },
    ],
    ["a field that coerces", { ...swapSpec, args: z.strictObject({ count: z.coerce.number() }) }],
    [
      "a coercing field inside a list",
      {
        ...swapSpec,
        args: z.strictObject({ legs: z.array(z.strictObject({ at: z.coerce.date() })) }),
      },
    ],
    [
      "a coercing field behind an option",
      { ...swapSpec, args: z.strictObject({ max: z.coerce.bigint().optional() }) },
    ],
  ])("refuses a tool declared with %s", (_case, spec) => {
    expect(() => defineTool(spec as ToolSpec<unknown>)).toThrow(
      expect.objectContaining({ code: "runtime.tool_invalid" }),
    );
  });
});
