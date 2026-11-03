import { createServer } from "node:http";
import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { bindListener, isPortTaken } from "./bind-listener.js";

const live = new AbortController().signal;

async function failureOf(bind: Promise<object>): Promise<BinferenceError> {
  const failed = await bind.then(
    () => undefined,
    (error: ErrorOptions["cause"]) => error,
  );
  expect(failed).toBeInstanceOf(BinferenceError);
  return failed as BinferenceError;
}

describe("binding a listener", () => {
  it("says a port another listener holds is taken", async () => {
    const holder = createServer();
    const held = await bindListener(holder, { host: "127.0.0.1", port: 0 }, live);
    const second = createServer();
    const failed = await failureOf(bindListener(second, held, live));
    expect(failed.code).toBe("server.listen_failed");
    expect(isPortTaken(failed)).toBe(true);
    holder.close();
  });

  it("does not call a start that was stopped a taken port", async () => {
    const stopped = new AbortController();
    const binding = bindListener(createServer(), { host: "127.0.0.1", port: 0 }, stopped.signal);
    stopped.abort();
    const failed = await failureOf(binding);
    expect(failed.details).toMatchObject({ systemCode: "none" });
    expect(isPortTaken(failed)).toBe(false);
  });

  it("does not call an address the system refuses a taken port", async () => {
    const failed = await failureOf(
      bindListener(createServer(), { host: "203.0.113.1", port: 0 }, live),
    );
    expect(failed.details).toMatchObject({ systemCode: "EADDRNOTAVAIL" });
    expect(isPortTaken(failed)).toBe(false);
  });
});
