import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf } from "../testing/agent-tool-fixtures.js";

const tab = { tab: "t1", url: "https://example.com/", title: "Example Domain" };
const snapshot = '- heading "Example Domain" [level=1] [ref=e3]\n- link "Learn more" [ref=e6]';
const shot = { path: "/w/media/browser/2026-11-08/a1.png", contentType: "image/png", bytes: 4 };

describe("the browse tool", () => {
  it("navigates through the engine and answers the tab and its snapshot", async () => {
    const run = callTool(
      { "browser/run": { running: true, tab, snapshot } },
      { name: "browse", args: { action: "navigate", url: "https://example.com/" } },
    );
    const outcome = await outcomeOf(run);
    expect(run.client.calls()).toStrictEqual([
      {
        op: "browser/run",
        args: { agent, request: { action: "navigate", url: "https://example.com/" } },
      },
    ]);
    expect(outcome).toMatchObject({ isError: false });
    expect(outcome.text).toContain("Tab t1 at https://example.com/: Example Domain");
    expect(outcome.text).toContain('link "Learn more" [ref=e6]');
  });

  it("builds an act from its kind's fields alone", async () => {
    const run = callTool(
      { "browser/run": { running: true, tab } },
      {
        name: "browse",
        args: { action: "act", kind: "click", ref: "e6", url: "ignored", tab: "t1" },
      },
    );
    await outcomeOf(run);
    expect(run.client.calls()).toStrictEqual([
      {
        op: "browser/run",
        args: { agent, request: { action: "act", tab: "t1", act: { kind: "click", ref: "e6" } } },
      },
    ]);
  });

  it("says what an act lacks before the engine hears of it", async () => {
    const run = callTool({}, { name: "browse", args: { action: "act" } });
    const outcome = await outcomeOf(run);
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toContain("act needs kind");
    const typed = await outcomeOf(
      callTool({}, { name: "browse", args: { action: "act", kind: "type", ref: "e1" } }),
    );
    expect(typed.text).toContain("at act.text");
    expect(run.client.calls()).toStrictEqual([]);
  });

  it("answers an action that failed as an error with the reason", async () => {
    const problem = "No element has ref e9 now: take a new snapshot.";
    const outcome = await outcomeOf(
      callTool(
        { "browser/run": { running: true, tab, problem } },
        { name: "browse", args: { action: "act", kind: "click", ref: "e9" } },
      ),
    );
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toContain(`The action failed: ${problem}`);
  });

  it("looks at a screenshot and names where it is saved", async () => {
    const run = callTool(
      {
        "browser/run": { running: true, tab, file: shot },
        "image/view": { contentType: "image/png", bytes: 4, offset: 0, data: "iVBORw==" },
      },
      { name: "browse", args: { action: "screenshot", question: "What does the chart show?" } },
    );
    const outcome = await outcomeOf(run);
    expect(run.client.calls()[1]).toStrictEqual({
      op: "image/view",
      args: { agent, path: shot.path },
    });
    expect(outcome.text).toContain(
      `Saved the screenshot at ${shot.path}; show it to the owner with show_images.`,
    );
    expect(outcome.text).toContain("What it shows: A price chart.");
  });

  it("names a saved PDF for send_files", async () => {
    const pdf = {
      path: "/w/media/browser/2026-11-08/a1.pdf",
      contentType: "application/pdf",
      bytes: 9,
    };
    const outcome = await outcomeOf(
      callTool(
        { "browser/run": { running: true, tab, file: pdf } },
        { name: "browse", args: { action: "pdf" } },
      ),
    );
    expect(outcome.text).toContain(`Saved the page as a PDF at ${pdf.path}`);
  });

  it("says why the browser refused, with the next step", async () => {
    const refused = new BinferenceError({ code: "browser.address_refused", message: "Refused." });
    const outcome = await outcomeOf(
      callTool(
        { "browser/run": refused },
        { name: "browse", args: { action: "open", url: "http://10.0.0.1/" } },
      ),
    );
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toContain("browser.allowPrivateNetwork");
  });
});
