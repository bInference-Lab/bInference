import { realpathSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { shellLauncherContract } from "../contracts/shell-launcher-contract.js";
import { createTempFolder, type TempFolder } from "../fakes/temp-folder.js";
import type { ShellLauncher } from "../ports.js";
import type { ShellLaunch } from "../shell-launch.js";
import { createImageShellLauncher } from "./image-shell-launcher.js";
import { osUserWall } from "./os-user-wall.js";
import { createPosixShellLauncher } from "./posix-shell-launcher.js";
import { type ServedShellLauncher, serveShellLauncher } from "./serve-shell-launcher.js";

const folders: TempFolder[] = [];
const stops: AbortController[] = [];
const servers: Server[] = [];

async function scratch(): Promise<string> {
  const folder = await createTempFolder("bnf-ish-");
  folders.push(folder);
  return realpathSync(folder.path);
}

afterEach(async () => {
  stops.splice(0).forEach((stop) => stop.abort());
  servers.splice(0).forEach((server) => server.close());
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const commands = {
  printsAndExits: "echo out; echo err 1>&2; exit 3",
  printsFolder: "pwd",
  waitsOnChild: "sleep 60 & wait",
};

const user = "binference-shell";

// A promise and the call that settles it, for a test to wait on an event.
function settledBy<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  const held: { settle?: (value: T) => void } = {};
  const promise = new Promise<T>((settle) => {
    held.settle = settle;
  });
  return { promise, resolve: (value) => held.settle?.(value) };
}

/** A launcher served in this process on a socket of a fresh folder, as the image serves its own. */
interface Served {
  readonly folder: string;
  readonly socket: string;
  readonly served: ServedShellLauncher;
  readonly stop: AbortController;
  /** Settles once the launcher has started its first command. */
  readonly started: Promise<void>;
}

async function serve(clock: ManualClock): Promise<Served> {
  const folder = await scratch();
  const socket = join(folder, "l.sock");
  const stop = new AbortController();
  stops.push(stop);
  const { promise: started, resolve } = settledBy<undefined>();
  const inner = createPosixShellLauncher(osUserWall, { loginShell: "/bin/bash", clock });
  const launcher: ShellLauncher = {
    wall: inner.wall,
    start: (launch, onOutput) => {
      const running = inner.start(launch, onOutput);
      resolve(undefined);
      return running;
    },
  };
  const own = { HOME: folder, USER: user, LOGNAME: user };
  const served = await serveShellLauncher({ socket, launcher, own }, stop.signal);
  return { folder, socket, served, stop, started };
}

function launchOf(folder: string, command: string, env: Record<string, string> = {}): ShellLaunch {
  return { command, folder, timeoutMs: 0, env: { PATH: "/usr/bin:/bin", ...env } };
}

// A launcher of the test's own, which answers each connection as `answer` says, as a command that
// replaced the image's launcher could.
async function fakeLauncher(answer: (socket: Socket) => void): Promise<string> {
  const socket = join(await scratch(), "f.sock");
  const server = createServer(answer);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(socket, resolve);
  });
  return socket;
}

describe.skipIf(process.platform === "win32")("the image's shell launcher", () => {
  it.each(
    shellLauncherContract({
      walls: true,
      create: async () => {
        const clock = createManualClock();
        const served = await serve(clock);
        const launcher = createImageShellLauncher({
          socket: served.socket,
          home: served.folder,
          clock,
        });
        // The launcher starts a command once its line arrives; time moves on only after that.
        const advance = async (delayMs: number): Promise<void> => {
          await served.started;
          await clock.advance(delayMs);
        };
        return { launcher, advance, folder: served.folder, commands };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("gives each command the launcher's home and user in place of the engine's", async () => {
    const clock = createManualClock();
    const served = await serve(clock);
    const launcher = createImageShellLauncher({ socket: served.socket, home: "/h", clock });
    let output = "";
    const running = launcher.start(
      launchOf(served.folder, 'echo "$HOME $USER $LOGNAME $KEPT"', {
        HOME: "/var/lib/binference",
        USER: "binference",
        KEPT: "kept",
      }),
      (text) => {
        output += text;
      },
    );

    await expect(running.ended).resolves.toMatchObject({ exitCode: 0 });
    expect(output.trim()).toBe(`${served.folder} ${user} ${user} kept`);
    expect(launcher.home).toBe("/h");
    expect(launcher.wall.state).toStrictEqual({ kind: "held", by: "os_user" });
  });

  it("stops every command it runs when it closes", async () => {
    const clock = createManualClock();
    const served = await serve(clock);
    const launcher = createImageShellLauncher({ socket: served.socket, home: "/h", clock });
    const running = launcher.start(launchOf(served.folder, commands.waitsOnChild), () => undefined);
    await served.started;

    served.stop.abort();

    await expect(running.ended).resolves.toMatchObject({ stopped: true });
    await expect(served.served.closed).resolves.toBeUndefined();
  });

  it("closes a connection whose first line is no command, and runs nothing", async () => {
    const served = await serve(createManualClock());
    const { promise: closed, resolve } = settledBy<string>();
    let said = "";
    const raw = connect(served.socket);
    raw.on("data", (chunk: Buffer) => {
      said += chunk.toString("utf8");
    });
    raw.once("close", () => resolve(said));
    raw.write('{"command":"echo hi"}\n');

    await expect(closed).resolves.toBe("");
  });
});

describe.skipIf(process.platform === "win32")("the engine's side of the shell launcher", () => {
  it("says why no launcher answers on the socket", async () => {
    const socket = join(await scratch(), "none.sock");
    const launcher = createImageShellLauncher({ socket, home: "/h", clock: createManualClock() });

    const end = await launcher.start(launchOf("/", "true"), () => undefined).ended;

    expect(end).toStrictEqual({ timedOut: false, stopped: false, failedToStart: "ENOENT" });
  });

  it("ends a connection at a line out of shape, and trusts nothing in it", async () => {
    const socket = await fakeLauncher((connection) => {
      connection.write('{"started":true}\n{"end":{"exitCode":0,"timedOut":false}}\n');
    });
    const launcher = createImageShellLauncher({ socket, home: "/h", clock: createManualClock() });

    const end = await launcher.start(launchOf("/", "true"), () => undefined).ended;

    expect(end).toStrictEqual({ timedOut: false, stopped: false });
  });

  it("ends a connection whose launcher writes more than 1 MiB without a line break", async () => {
    const socket = await fakeLauncher((connection) => {
      connection.write('{"started":true}\n');
      connection.write(`{"output":"${"x".repeat(1_048_577)}`);
    });
    const launcher = createImageShellLauncher({ socket, home: "/h", clock: createManualClock() });
    let output = "";

    const end = await launcher.start(launchOf("/", "true"), (text) => {
      output += text;
    }).ended;

    expect(end).toStrictEqual({ timedOut: false, stopped: false });
    expect(output).toBe("");
  });

  it("ends a command its launcher keeps after a stop, 10 seconds on", async () => {
    const socket = await fakeLauncher((connection) => {
      connection.on("data", () => undefined);
      connection.write('{"started":true}\n{"output":"up\\n"}\n');
    });
    const clock = createManualClock();
    const launcher = createImageShellLauncher({ socket, home: "/h", clock });
    const { promise: up, resolve } = settledBy<undefined>();
    const running = launcher.start(launchOf("/", "sleep 60"), () => resolve(undefined));
    await up;

    running.stop();
    await clock.advance(10_000);

    await expect(running.ended).resolves.toStrictEqual({ timedOut: false, stopped: true });
  });

  it("ends a command its launcher keeps past its time limit, 10 seconds on", async () => {
    const socket = await fakeLauncher((connection) => {
      connection.on("data", () => undefined);
      connection.write('{"started":true}\n{"output":"up\\n"}\n');
    });
    const clock = createManualClock();
    const launcher = createImageShellLauncher({ socket, home: "/h", clock });
    const { promise: up, resolve } = settledBy<undefined>();
    const running = launcher.start({ ...launchOf("/", "sleep 60"), timeoutMs: 500 }, () =>
      resolve(undefined),
    );
    await up;

    await clock.advance(10_500);

    await expect(running.ended).resolves.toStrictEqual({ timedOut: true, stopped: false });
  });
});
