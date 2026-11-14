import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { BrowserDriver } from "../browse/ports.js";

/**
 * An adapter under test and what it serves: a page with a title, a word in its prose and a button
 * whose press sets the title to `clickedTitle`, and an address its check refuses.
 */
export interface BrowserDriverSubject {
  readonly driver: BrowserDriver;
  readonly page: {
    readonly url: string;
    readonly title: string;
    readonly word: string;
    readonly clickedTitle: string;
  };
  readonly refusedUrl: string;
}

/** Makes a fresh {@link BrowserDriverSubject} for each check. */
export interface BrowserDriverHarness {
  create(): Promise<BrowserDriverSubject>;
}

type Check = (subject: BrowserDriverSubject) => Promise<void>;

const signal = new AbortController().signal;

const startsAndStops: Check = async ({ driver, page }) => {
  const before = await driver.run({ action: "status" }, { signal });
  assert.ok(before.ok);
  assert.equal(before.value.view.running, false);
  await driver.run({ action: "navigate", url: page.url }, { signal });
  assert.equal(driver.isRunning(), true);
  await driver.stop();
  assert.equal(driver.isRunning(), false);
};

const navigates: Check = async ({ driver, page }) => {
  const went = await driver.run({ action: "navigate", url: page.url }, { signal });
  assert.ok(went.ok);
  assert.equal(went.value.view.tab?.title, page.title);
  assert.match(went.value.view.snapshot ?? "", /\[ref=e\d+\]/u);
};

const presses: Check = async ({ driver, page }) => {
  await driver.run({ action: "navigate", url: page.url }, { signal });
  const seen = await driver.run({ action: "snapshot" }, { signal });
  assert.ok(seen.ok);
  const ref = /button "[^"]*" \[ref=(e\d+)\]/u.exec(seen.value.view.snapshot ?? "")?.[1];
  assert.ok(ref !== undefined);
  const pressed = await driver.run({ action: "act", act: { kind: "click", ref } }, { signal });
  assert.ok(pressed.ok);
  assert.equal(pressed.value.view.problem, undefined);
  const tabs = await driver.run({ action: "tabs" }, { signal });
  assert.ok(tabs.ok);
  assert.ok(tabs.value.view.tabs?.some((tab) => tab.title === page.clickedTitle));
};

const missesRef: Check = async ({ driver, page }) => {
  await driver.run({ action: "navigate", url: page.url }, { signal });
  const act = { kind: "click", ref: "e99999", timeoutMs: 1_000 } as const;
  const pressed = await driver.run({ action: "act", act }, { signal });
  assert.ok(pressed.ok);
  assert.ok((pressed.value.view.problem ?? "") !== "");
};

const readsAndShoots: Check = async ({ driver, page }) => {
  await driver.run({ action: "navigate", url: page.url }, { signal });
  const read = await driver.run({ action: "text" }, { signal });
  assert.ok(read.ok);
  assert.ok((read.value.view.text ?? "").includes(page.word));
  const shot = await driver.run({ action: "screenshot" }, { signal });
  assert.ok(shot.ok);
  assert.equal(shot.value.capture?.contentType, "image/png");
  assert.deepEqual([...(shot.value.capture?.bytes.subarray(0, 4) ?? [])], [137, 80, 78, 71]);
};

const missesSelector: Check = async ({ driver, page }) => {
  await driver.run({ action: "navigate", url: page.url }, { signal });
  const read = await driver.run({ action: "text", selector: "#none-matches" }, { signal });
  assert.ok(read.ok);
  assert.equal(read.value.view.text, undefined);
  assert.ok((read.value.view.problem ?? "") !== "");
};

const refuses: Check = async ({ driver, refusedUrl }) => {
  const went = await driver.run({ action: "navigate", url: refusedUrl }, { signal });
  assert.deepEqual(went, { ok: false, error: "address_refused" });
  const opened = await driver.run({ action: "open", url: refusedUrl }, { signal });
  assert.deepEqual(opened, { ok: false, error: "address_refused" });
};

const keepsTabs: Check = async ({ driver, page }) => {
  await driver.run({ action: "navigate", url: page.url }, { signal });
  const opened = await driver.run({ action: "open", url: page.url }, { signal });
  assert.ok(opened.ok);
  const { tabs } = opened.value.view;
  assert.ok(tabs !== undefined);
  assert.equal(tabs.length, 2);
  const [first, second] = tabs;
  assert.ok(first !== undefined);
  assert.ok(second !== undefined);
  const focused = await driver.run({ action: "focus", tab: first.tab }, { signal });
  assert.ok(focused.ok);
  assert.equal(focused.value.view.tab?.tab, first.tab);
  const closed = await driver.run({ action: "close", tab: first.tab }, { signal });
  assert.ok(closed.ok);
  assert.deepEqual(
    closed.value.view.tabs?.map(({ tab }) => tab),
    [second.tab],
  );
  const gone = await driver.run({ action: "focus", tab: first.tab }, { signal });
  assert.deepEqual(gone, { ok: false, error: "tab_not_found" });
};

const stopsOnRequest: Check = async ({ driver, page }) => {
  await driver.run({ action: "navigate", url: page.url }, { signal });
  const stopped = await driver.run({ action: "stop" }, { signal });
  assert.deepEqual(stopped, { ok: true, value: { view: { running: false } } });
  assert.equal(driver.isRunning(), false);
};

const checks: readonly (readonly [string, Check])[] = [
  ["runs no browser before a call starts one, and none after a stop", startsAndStops],
  ["navigates and answers the page's snapshot with refs", navigates],
  ["presses a button by its snapshot ref", presses],
  ["answers a problem for a ref no element holds", missesRef],
  ["reads the page's prose and takes a PNG screenshot", readsAndShoots],
  ["answers a problem at once for a selector no element matches", missesSelector],
  ["refuses an address its check refuses, in a tab or a new one", refuses],
  ["opens a new tab, focuses and closes one by its id, and refuses an id no tab holds", keepsTabs],
  ["stops the browser on a stop request", stopsOnRequest],
];

/** The contract every `BrowserDriver` adapter passes; each check stops its browser at its end. */
export function browserDriverContract(harness: BrowserDriverHarness): readonly ContractCheck[] {
  return checks.map(([name, check]) => ({
    name,
    run: async () => {
      const subject = await harness.create();
      try {
        await check(subject);
      } finally {
        await subject.driver.stop();
      }
    },
  }));
}
