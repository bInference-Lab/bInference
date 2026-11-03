import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  handlersReaching,
  isPortTaken,
  isPublished,
  publishesExtra,
  reachesEngine,
} from "./remote-handlers.js";
import type { ServeConfig, ServeHandler, ServePort } from "./serve-config.js";

const name = "box.tail1234.ts.net";
const at = { name, ports: { engine: 7456, webhooks: 7457 } };
const ours: readonly ServeHandler[] = [
  { hostPort: `${name}:443`, mount: "/", proxy: "http://127.0.0.1:7456" },
  { hostPort: `${name}:8443`, mount: "/hook/", proxy: "http://127.0.0.1:7457/hook/" },
];
const ourPorts: readonly ServePort[] = [
  { port: "443", https: true },
  { port: "8443", https: true },
];

// Every way a target names this machine and the engine's port.
const engineTargets = [
  "http://127.0.0.1:7456",
  "http://localhost:7456/",
  "http://[::1]:7456",
  "http://[::ffff:127.0.0.1]:7456",
  "http://127.1.2.3:7456",
  "http://0.0.0.0:7456",
  "http://[::]:7456",
  "7456",
  "localhost:7456",
];

const hostPortArb = fc.constantFrom(`${name}:443`, `${name}:8443`, `${name}:10000`, `other:443`);
const mountArb = fc.constantFrom("/", "/hook/", "/blog/");
const targetArb = fc.oneof(
  fc.constantFrom(...engineTargets),
  fc.constantFrom("http://127.0.0.1:3000", "http://127.0.0.1:7457/hook/", "http://10.0.0.5:7456"),
);
const extraHandlerArb = fc.record({ hostPort: hostPortArb, mount: mountArb, proxy: targetArb });
// A handler to the engine anywhere but binference's own Mini App mount.
const engineExtraArb = fc
  .record({ hostPort: hostPortArb, mount: mountArb, proxy: fc.constantFrom(...engineTargets) })
  .filter((extra) => extra.hostPort !== `${name}:443` || extra.mount !== "/");
// Any handler on a port other than binference's webhook port.
const elsewhereArb = extraHandlerArb.filter((extra) => extra.hostPort !== `${name}:8443`);
// Another mount on the Mini App's port.
const miniExtraArb = fc.record({
  hostPort: fc.constant(`${name}:443`),
  mount: fc.constantFrom("/hook/", "/blog/"),
  proxy: targetArb,
});

function config(
  handlers: readonly ServeHandler[],
  funnel: readonly string[],
  ports: readonly ServePort[] = ourPorts,
): ServeConfig {
  return { ports, handlers, funnel: new Set(funnel) };
}

describe("the judgments of what Tailscale publishes", () => {
  it("find the engine's port in every form a target names this machine by", () => {
    for (const target of engineTargets) {
      const extra = { hostPort: `${name}:10000`, mount: "/", proxy: target };
      expect(reachesEngine(config([...ours, extra], []), at)).toBe(true);
      expect(
        reachesEngine(config(ours, [], [{ port: "2222", https: false, forward: target }]), at),
      ).toBe(true);
    }
  });

  it("keep a background TCP forward a foreground session's entry for the same port would hide", () => {
    const ports: readonly ServePort[] = [
      { port: "443", https: true },
      { port: "443", https: false, forward: "127.0.0.1:7456" },
    ];
    expect(reachesEngine(config(ours.slice(0, 1), [], ports), at)).toBe(true);
    expect(isPortTaken(config(ours.slice(0, 1), [], ports), at, "mini")).toBe(true);
  });

  it("pass binference's own handlers alone, and nothing else extra", () => {
    const own = config(ours, [`${name}:8443`]);
    expect([reachesEngine(own, at), publishesExtra(own, at)]).toStrictEqual([false, false]);
    expect([isPublished(own, at, "mini"), isPublished(own, at, "webhooks")]).toStrictEqual([
      true,
      true,
    ]);
  });

  it("flag and name as left any added handler that reaches the engine", () => {
    fc.assert(
      fc.property(engineExtraArb, (extra) => {
        const seen = config([...ours, extra], [`${name}:8443`]);
        expect(reachesEngine(seen, at)).toBe(true);
        expect(handlersReaching(seen, at).map((left) => left.target)).toContain(extra.proxy);
      }),
    );
  });

  it("flag any funnel beyond binference's webhook port as extra", () => {
    fc.assert(
      fc.property(elsewhereArb, (extra) => {
        const seen = config([...ours, extra], [`${name}:8443`, extra.hostPort]);
        expect(publishesExtra(seen, at)).toBe(true);
      }),
    );
  });

  it("never read the Mini App as published beside another handler on its port", () => {
    fc.assert(
      fc.property(miniExtraArb, (extra) => {
        expect(isPublished(config([...ours, extra], [`${name}:8443`]), at, "mini")).toBe(false);
        expect(isPortTaken(config([...ours, extra], [`${name}:8443`]), at, "mini")).toBe(true);
      }),
    );
  });
});
