// A loopback TCP proxy between a test's pool and the Postgres server that cuts a write
// transaction's COMMIT where the test says, as a network can: before the server sees it, after
// the server applied it but before the client hears, held with the session left open, or dropped
// on the client's side while the server's session stays (decision 0438). It can also hold every
// status ask and session end of a write's check, as a path that stops answering. It reads the
// frontend's messages after the startup packet, one type byte and an int32 length each, and knows
// a write by its `start transaction ... read write` and a check's query by `pg_xact_status(` or
// `pg_terminate_backend(`. Nothing in production uses this file.
import { connect, createServer, type Server, type Socket } from "node:net";

/** Where a write's COMMIT is cut. */
export type CommitCut = "before" | "after" | "hold" | "drop";

/** Which write commits a plan cuts: the next one only, each one, or every other one. */
export type CutRule = "next" | "each" | "alternate";

/** A proxy the test's pool connects through, and the plan it cuts commits by. */
export interface CommitCutProxy {
  readonly port: number;
  /** Cuts write commits by `rule` from now on; "pass" lets every one through. */
  plan(cut: CommitCut | "pass", rule?: CutRule): void;
  /** Refuses every new connection from now on, as a database that cannot be reached. */
  refuseNewConnections(): void;
  /** Takes new connections again. */
  acceptNewConnections(): void;
  /** How many commits the proxy cut so far. */
  cuts(): number;
  /** How many write transactions the proxy has seen begin. */
  writesBegun(): number;
  /** Resolves once the proxy holds a commit, with the session left open. */
  held(): Promise<void>;
  /** Sends every held COMMIT on, as a network that answers again. */
  releaseCommits(): void;
  /** Holds every status ask's and session end's query from now on, unsent and unanswered. */
  holdChecks(): void;
  /** Sends the status asks and session ends that come from now on. */
  passChecks(): void;
  /** Resolves once the proxy holds a status ask or a session end. */
  checkHeld(): Promise<void>;
  close(): Promise<void>;
}

/** Callers waiting for something to happen, told once it does. */
interface Waiters {
  wait(): Promise<void>;
  tell(): void;
}

function createWaiters(): Waiters {
  const waiting: (() => void)[] = [];
  return {
    wait: async () =>
      new Promise<void>((resolve) => {
        waiting.push(resolve);
      }),
    tell: () => {
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
}

/** The check's queries the proxy holds while its switch is on, and who waits for one. */
interface AskHolds extends Waiters {
  isOn(): boolean;
  hold(): void;
  pass(): void;
}

function createAskHolds(): AskHolds {
  let isOn = false;
  return {
    ...createWaiters(),
    isOn: () => isOn,
    hold: () => {
      isOn = true;
    },
    pass: () => {
      isOn = false;
    },
  };
}

/** The proxy's plan, counts and holds, shared by its connections. */
interface Cutter {
  plan(cut: CommitCut | "pass", rule: CutRule): void;
  /** Counts a write's begin. */
  begun(): void;
  /** What to do with the next write commit, counted as a cut unless it passes. */
  decide(): CommitCut | "pass";
  readonly commitHolds: Waiters;
  readonly askHolds: AskHolds;
  /** The sends of each held commit, run once the test releases them. */
  readonly releases: (() => void)[];
  readonly cuts: () => number;
  readonly writes: () => number;
}

function createCutter(): Cutter {
  let cut: CommitCut | "pass" = "pass";
  let rule: CutRule = "each";
  let seen = 0;
  let cuts = 0;
  let writes = 0;
  const commitHolds = createWaiters();
  const pick = (): CommitCut | "pass" => {
    if (cut === "pass" || rule === "each") {
      return cut;
    }
    return (rule === "next" ? seen === 1 : seen % 2 === 1) ? cut : "pass";
  };
  return {
    plan(next, nextRule) {
      cut = next;
      rule = nextRule;
      seen = 0;
    },
    begun: () => {
      writes += 1;
    },
    decide() {
      seen += 1;
      const picked = pick();
      cuts += picked === "pass" ? 0 : 1;
      if (picked === "hold") {
        commitHolds.tell();
      }
      return picked;
    },
    commitHolds,
    askHolds: createAskHolds(),
    releases: [],
    cuts: () => cuts,
    writes: () => writes,
  };
}

// The text of a query or of a parsed statement, or empty for any other message.
function queryText(message: Buffer): string {
  const type = String.fromCharCode(message[0] ?? 0);
  const body = message.subarray(5);
  if (type === "Q") {
    return body.toString("utf8").replace(/\0$/, "");
  }
  if (type === "P") {
    const nameEnd = body.indexOf(0);
    const textEnd = body.indexOf(0, nameEnd + 1);
    return body.toString("utf8", nameEnd + 1, textEnd);
  }
  return "";
}

// Splits the frontend's stream into messages: the startup packet first, then typed ones.
function frontendReader(onMessage: (message: Buffer) => void): (chunk: Buffer) => void {
  let pending = Buffer.alloc(0);
  let isStarted = false;
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const head = isStarted ? 5 : 4;
      if (pending.length < head) {
        return;
      }
      const size = isStarted ? 1 + pending.readInt32BE(1) : pending.readInt32BE(0);
      if (pending.length < size) {
        return;
      }
      const message = pending.subarray(0, size);
      pending = pending.subarray(size);
      isStarted = true;
      onMessage(message);
    }
  };
}

// The functions only a write's status check calls.
const checkQueries = ["pg_xact_status(", "pg_terminate_backend("];

/** What a connection does with one frontend message. */
type Step = CommitCut | "pass" | "forward" | "ask";

// What one connection does with each frontend message: send it on, hold a status ask, or the cut
// its commit took.
function commitJudge(cutter: Cutter): (message: Buffer) => Step {
  let isWrite = false;
  return (message) => {
    const text = queryText(message).trim().toLowerCase();
    if (cutter.askHolds.isOn() && checkQueries.some((name) => text.includes(name))) {
      return "ask";
    }
    if (text.startsWith("start transaction")) {
      isWrite = text.includes("read write");
      if (isWrite) {
        cutter.begun();
      }
    }
    // A rolled back write ends there: the next transaction on the connection may be a read.
    const isEnd = text === "commit" || text === "rollback";
    const wasWrite = isWrite;
    isWrite &&= !isEnd;
    return text === "commit" && wasWrite ? cutter.decide() : "forward";
  };
}

/** One connection's two sockets, and what a cut sets on it. */
interface Pipe {
  readonly client: Socket;
  readonly server: Socket;
  /** A drop cut the client alone: the server's session stays open. */
  readonly keepServer: () => void;
  /** A commit was cut after it landed: the server's answer goes unheard. */
  readonly cutAfter: () => void;
}

// Sends each frontend message on, or holds it, or cuts the pipe, as the plan says.
function frontendSide(pipe: Pipe, cutter: Cutter): (message: Buffer) => void {
  const judge = commitJudge(cutter);
  const unsent: Buffer[] = [];
  let isHeld = false;
  const release = (): void => {
    isHeld = false;
    unsent.splice(0).forEach((message) => pipe.server.write(message));
  };
  // Whether the step holds the connection's messages, and who hears that it does.
  const holds = (step: Step): boolean => {
    if (step === "hold") {
      cutter.releases.push(release);
    }
    if (step === "ask") {
      cutter.askHolds.tell();
    }
    return step === "hold" || step === "ask";
  };
  return (message) => {
    const step = judge(message);
    if (step === "drop") {
      pipe.keepServer();
    }
    if (step === "before" || step === "drop") {
      pipe.client.destroy();
      return;
    }
    if (step === "after") {
      pipe.cutAfter();
    }
    isHeld ||= holds(step);
    if (isHeld) {
      unsent.push(message);
    } else if (!pipe.client.destroyed) {
      pipe.server.write(message);
    }
  };
}

/** Pipes one client connection to the server, cutting its write commits as the plan says. */
function pipeOne(
  client: Socket,
  target: { readonly host: string; readonly port: number },
  cutter: Cutter,
): Socket {
  const server = connect(target.port, target.host);
  let keepsServer = false;
  let isCutAfter = false;
  const pipe: Pipe = {
    client,
    server,
    keepServer: () => {
      keepsServer = true;
    },
    cutAfter: () => {
      isCutAfter = true;
    },
  };
  client.on("data", frontendReader(frontendSide(pipe, cutter)));
  // The server answers a COMMIT with CommandComplete first: a cut after drops it unheard.
  server.on("data", (chunk: Buffer) => {
    if (isCutAfter && chunk[0] === "C".charCodeAt(0)) {
      client.destroy();
      return;
    }
    client.write(chunk);
  });
  // A dropped client leaves the server's session open, until the server or the proxy ends it.
  const clientGone = (): void => {
    if (!keepsServer) {
      server.destroy();
    }
  };
  client.on("error", clientGone);
  client.on("close", clientGone);
  server.on("error", () => client.destroy());
  server.on("close", () => client.destroy());
  return server;
}

// The proxy's holds, as the test drives them.
function holdsOf(
  cutter: Cutter,
): Pick<CommitCutProxy, "held" | "releaseCommits" | "holdChecks" | "passChecks" | "checkHeld"> {
  return {
    held: async () => cutter.commitHolds.wait(),
    releaseCommits: () => cutter.releases.splice(0).forEach((release) => release()),
    holdChecks: () => cutter.askHolds.hold(),
    passChecks: () => cutter.askHolds.pass(),
    checkHeld: async () => cutter.askHolds.wait(),
  };
}

/** Starts a proxy on 127.0.0.1 to the Postgres server at `target`, passing everything. */
export async function startCommitCutProxy(target: {
  readonly host: string;
  readonly port: number;
}): Promise<CommitCutProxy> {
  const cutter = createCutter();
  let isRefusing = false;
  const sockets = new Set<Socket>();
  const proxy: Server = createServer((client) => {
    if (isRefusing) {
      client.destroy();
      return;
    }
    const server = pipeOne(client, target, cutter);
    for (const socket of [client, server]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    }
  });
  await new Promise<void>((resolve) => {
    proxy.listen(0, "127.0.0.1", () => resolve());
  });
  const address = proxy.address();
  return {
    port: typeof address === "object" && address !== null ? address.port : 0,
    plan: (cut, rule = "each") => cutter.plan(cut, rule),
    refuseNewConnections: () => {
      isRefusing = true;
    },
    acceptNewConnections: () => {
      isRefusing = false;
    },
    cuts: cutter.cuts,
    writesBegun: cutter.writes,
    ...holdsOf(cutter),
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        proxy.close(() => resolve());
      });
    },
  };
}
