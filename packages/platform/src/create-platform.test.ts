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
      "stop",
      "uninstall",
    ]);
  });
});

describe.runIf(process.platform === "linux")("platform on Linux", () => {
  it("has a desktop session only when DISPLAY or WAYLAND_DISPLAY names one", () => {
    expect(createPlatform({}).hasDesktopSession).toBe(false);
    expect(createPlatform({ display: "", waylandDisplay: "" }).hasDesktopSession).toBe(false);
    expect(createPlatform({ display: ":0" }).hasDesktopSession).toBe(true);
    expect(createPlatform({ waylandDisplay: "wayland-0" }).hasDesktopSession).toBe(true);
  });
});

describe.runIf(process.platform !== "linux")("platform on macOS and Windows", () => {
  it("always has a desktop session", () => {
    expect(createPlatform({}).hasDesktopSession).toBe(true);
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

  it("runs commands through the image's shell launcher when its socket is named", () => {
    const platform = createPlatform({
      binferenceHome: "/srv/binference",
      shellLauncher: "/srv/shell/run/launcher.sock",
    });
    const launcher = platform.shellLauncher(createManualClock());

    expect(platform.commandWall.state).toStrictEqual({ kind: "held", by: "os_user" });
    expect(launcher.wall).toStrictEqual({ kind: "held", by: "os_user" });
    expect(launcher.home).toBe("/var/lib/binference/.binference/shell/home");
    expect(platform.shareWorkspace).toBeTypeOf("function");
  });

  it("walls the owner's shell when no shell launcher is named", () => {
    const platform = createPlatform({ binferenceHome: "/srv/binference", shellLauncher: "" });
    const launcher = platform.shellLauncher(createManualClock());

    expect(launcher.home).toBeUndefined();
    expect(platform.shareWorkspace).toBeUndefined();
    expect(launcher.wall).not.toStrictEqual({ kind: "held", by: "os_user" });
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
