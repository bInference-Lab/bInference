import { resolve } from "node:path";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createPlatform } from "./create-platform.js";

describe("platform", () => {
  it("resolves the state folder it was given", () => {
    const home = resolve("/srv/binference");

    expect(createPlatform({ binferenceHome: home }).stateFolder.root).toBe(home);
  });

  it("gives this OS's keychain and service manager", () => {
    const platform = createPlatform({ xdgConfigHome: "relative/config" });

    expect(Object.keys(platform.keychain).toSorted()).toStrictEqual(["delete", "read", "write"]);
    expect(Object.keys(platform.serviceManager(createManualClock())).toSorted()).toStrictEqual([
      "install",
      "status",
      "uninstall",
    ]);
  });
});

describe.skipIf(process.platform === "win32")("platform on macOS and Linux", () => {
  it("puts endpoints in the run folder as sockets and stops on SIGINT or SIGTERM", () => {
    const platform = createPlatform({ binferenceHome: "/srv/binference" });

    expect(platform.ipcEndpoint({ name: "engine", installId: "ins_1" }).address).toBe(
      "/srv/binference/run/engine.sock",
    );
    expect(platform.stopSignals).toStrictEqual(["SIGINT", "SIGTERM"]);
  });
});

describe.runIf(process.platform === "win32")("platform on Windows", () => {
  it("names endpoints as pipes and stops on SIGINT or SIGBREAK", () => {
    const platform = createPlatform({ binferenceHome: "C:\\binference" });

    expect(platform.ipcEndpoint({ name: "engine", installId: "ins_1" }).address).toBe(
      "\\\\.\\pipe\\binference-ins_1-engine",
    );
    expect(platform.stopSignals).toStrictEqual(["SIGINT", "SIGBREAK"]);
  });
});
