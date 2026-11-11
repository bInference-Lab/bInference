import { BinferenceError, type JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { helperToolBox } from "./agent-tools.js";

const url = "https://api.example.com/v1/q?key={{credential:API_KEY}}";

const answered = (view: { readonly [key: string]: JsonValue }) => ({
  kind: "answer",
  status: 200,
  headers: [{ name: "content-type", value: "application/json" }],
  contentType: "application/json",
  bytes: 11,
  body: '{"n":"{{credential:API_KEY}}"}',
  binary: false,
  cut: false,
  durationMs: 41,
  ...view,
});

const call = async (answer: FakeAnswer, args: JsonValue = { method: "GET", url }) => {
  const run = callTool({ "http/request": answer }, { name: "http_request", args });
  return { run, outcome: await outcomeOf(run) };
};

describe("the http_request tool", () => {
  it("sends the request through the engine and marks the site's answer as outside content", async () => {
    const headers = [{ name: "Authorization", value: "Bearer {{credential:API_KEY}}" }];
    const args = { method: "POST", url, headers, body: "{}", timeoutSeconds: 90 };
    const { run, outcome } = await call(answered({}), args);
    expect(run.client.calls()).toStrictEqual([
      { op: "http/request", args: { agent, ...args, timeoutSeconds: 25 } },
    ]);
    expect(outcome).toMatchObject({ isError: false, outside: true });
    expect(outcome.text).toBe(
      'HTTP 200 from api.example.com in 41 ms.\ncontent-type: application/json\n\n{"n":"{{credential:API_KEY}}"}',
    );
  });

  it("says a redirect is not followed and where it goes", async () => {
    const location = "https://login.example/next";
    const view = answered({ status: 302, headers: [{ name: "location", value: location }] });
    const { body: _body, ...empty } = view;
    const { outcome } = await call(empty);
    expect(outcome.text).toContain(`It redirects to ${location}. binference follows no redirect`);
    expect(outcome.text).toContain("The body is empty.");
  });

  it("names a body that is not text by its type and size, and a cut body", async () => {
    const binary = answered({ contentType: "image/png", bytes: 52_344, binary: true });
    const { body: _body, ...noBody } = binary;
    expect((await call(noBody)).outcome.text).toContain(
      "The body is not text (image/png, 52344 bytes), so it is not shown.",
    );
    const cut = (await call(answered({ cut: true }))).outcome.text;
    expect(cut).toContain("[cut: the body went on past 10000 characters]");
    const head = await call(answered({}), { method: "HEAD", url });
    expect(head.outcome.text).toContain("A HEAD answer has no body.");
  });

  it.each([
    {
      reason: "credential_host",
      view: { credential: "API_KEY", host: "eu.api.example.com:8443" },
      says: "--allow-host eu.api.example.com",
    },
    {
      reason: "credential_unknown",
      view: { credential: "NO_KEY", host: "api.example.com" },
      says: "no credential NO_KEY is stored",
    },
    {
      reason: "credential_outside",
      view: { credential: "API_KEY", host: "api.example.com" },
      says: "send /clear to start a new chat and ask you again",
    },
    { reason: "standin_place", view: { host: "api.example.com" }, says: "never in the host" },
    {
      reason: "standin_malformed",
      view: { host: "api.example.com" },
      says: "write each stand-in whole",
    },
    {
      reason: "value_unfit",
      view: { credential: "API_KEY", host: "api.example.com" },
      says: "a character a header cannot carry",
    },
  ])(
    "words a $reason refusal as nothing sent, never as outside content",
    async ({ reason, view, says }) => {
      const { outcome } = await call({ kind: "refused", reason, ...view });
      expect(outcome.text).toContain("Refused, nothing was sent:");
      expect(outcome.text).toContain(says);
      expect(outcome).toMatchObject({ isError: true });
      expect(outcome.outside).toBeUndefined();
    },
  );

  it("words the engine's refusals of an address and a failure", async () => {
    const refused = new BinferenceError({ code: "request.address_refused", message: "refused" });
    const address = await call(refused);
    expect(address.outcome).toMatchObject({ isError: true });
    expect(address.outcome.text).toContain("only https addresses on the public internet");
    expect(address.outcome.outside).toBeUndefined();
    const slow = await call(new BinferenceError({ code: "request.timed_out", message: "slow" }));
    expect(slow.outcome.text).toContain("within the time limit, at most 25 seconds");
  });

  it("refuses a body with GET before the engine hears of it", async () => {
    const { run, outcome } = await call(answered({}), { method: "GET", url, body: "{}" });
    expect([outcome.isError, outcome.text]).toStrictEqual([
      true,
      "Refused, nothing was sent: GET and HEAD take no body.",
    ]);
    expect(run.client.calls()).toStrictEqual([]);
  });

  it("refuses a header binference sets itself before the engine hears of it", () => {
    const headers = [{ name: "Host", value: "evil.example" }];
    const run = callTool({}, { name: "http_request", args: { method: "GET", url, headers } });
    expect(run.refused).toMatch(/^not run: the arguments do not match/);
    expect(run.client.calls()).toStrictEqual([]);
  });

  it("is never a helper's", () => {
    const parts = { agent, client: createFakeToolClient({}), turn: toolTurn };
    const names = helperToolBox(parts).declarations.map(({ name }) => name);
    expect(names).not.toContain("http_request");
    expect(names).toContain("browse");
  });
});
