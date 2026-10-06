import { describe, expect, it } from "vitest";
import type { ServiceDefinition } from "../service/service-definition.js";
import { renderSystemdUnit, systemdUnitName } from "./systemd-unit.js";

const engine: ServiceDefinition = {
  name: "engine",
  description: "binference engine at 100%",
  program: "/opt/binference/state/node/bin/node",
  args: ["/opt/binference/my apps/engine.mjs", 'say "hi"', "back\\slash", "50%", "$HOME"],
  workingFolder: "/opt/binference/state",
  logFile: "/opt/binference/state/logs/service.log",
  stopTimeoutMs: 30_000,
};

describe("systemd unit", () => {
  it("names the unit after the service", () => {
    expect(systemdUnitName("engine")).toBe("binference-engine.service");
  });

  it("quotes every word and keeps systemd from expanding specifiers and variables", () => {
    expect(renderSystemdUnit(engine)).toBe(
      [
        "[Unit]",
        "Description=binference engine at 100%%",
        "",
        "[Service]",
        'ExecStart="/opt/binference/state/node/bin/node" "/opt/binference/my apps/engine.mjs" ' +
          '"say \\"hi\\"" "back\\\\slash" "50%%" "$$HOME"',
        "WorkingDirectory=/opt/binference/state",
        "Restart=on-failure",
        "RestartSec=10",
        "TimeoutStopSec=30",
        "KillMode=mixed",
        "UMask=0077",
        "LimitCORE=0",
        "StandardInput=null",
        "StandardOutput=append:/opt/binference/state/logs/service.log",
        "StandardError=append:/opt/binference/state/logs/service.log",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    );
  });
});
