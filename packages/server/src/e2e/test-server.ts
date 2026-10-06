import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { createProtocolClient, type ProtocolClient } from "@binference/client";
import { type Id, idSchema } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
  type ManualClock,
  type MemoryLogger,
} from "@binference/core/testing";
import {
  type AccessStore,
  type IdempotencyStore,
  sha256Hex,
  type TokenKind,
} from "@binference/engine";
import { createMemoryAccessStore, createMemoryIdempotencyStore } from "@binference/engine/testing";
import {
  type ClientKind,
  type Credential,
  type DeviceProofInput,
  deviceProofText,
  type EngineState,
  operations,
  type Scope,
} from "@binference/protocol";
import { WebSocket } from "ws";
import { createProtocolServer, type ProtocolServer } from "../create-protocol-server.js";
import type { OperationHandlers } from "../operation-handlers.js";
import type { ServerLimits } from "../server-limits.js";

/** A client token the test server knows, with its secret. */
interface TestToken {
  readonly id: Id<"tok">;
  readonly secret: string;
}

/** A console device the test server paired, with its private key. */
export interface TestDevice {
  readonly id: Id<"dev">;
  readonly privateKey: KeyObject;
}

/** A protocol server on 127.0.0.1 with an IPC stand-in, memory stores and a manual clock. */
export interface TestServer {
  readonly server: ProtocolServer;
  /** The HTTP listener's WebSocket. */
  readonly wsUrl: string;
  /** The IPC stand-in: a loopback TCP listener whose sockets go to `acceptIpc`. */
  readonly ipcUrl: string;
  /** The HTTP listener's own origin, which the server allows. */
  readonly origin: string;
  readonly httpPort: number;
  readonly clock: ManualClock;
  readonly logger: MemoryLogger;
  readonly access: AccessStore;
  readonly idempotency: IdempotencyStore;
  /** The CLI's token: every scope but `agent`. */
  readonly cliToken: TestToken;
  /** An MCP token: `read` and `propose`. */
  readonly mcpToken: TestToken;
  readonly device: TestDevice;
  /** Closes the server and the IPC stand-in. */
  close(): Promise<void>;
}

/** What a test server starts with. */
export interface TestServerOptions {
  readonly handlers?: OperationHandlers;
  readonly state?: () => EngineState;
  readonly limits?: Partial<ServerLimits>;
}

const cliScopes: readonly Scope[] = ["read", "propose", "chat", "confirm", "loosen", "admin"];

function fixtureId<P extends string>(prefix: P, n: number): Id<P> {
  return idSchema(prefix).parse(`${prefix}_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`);
}

async function addToken(
  access: AccessStore,
  token: { readonly n: number; readonly kind: TokenKind; readonly scopes: readonly Scope[] },
): Promise<TestToken> {
  const secret = `bnt_${String(token.n).repeat(43)}`;
  const id = fixtureId("tok", token.n);
  const record = {
    id,
    label: token.kind,
    kind: token.kind,
    scopes: token.scopes,
    secretHash: sha256Hex(secret),
    createdAtMs: 0,
  };
  await access.addToken(record, { signal: AbortSignal.timeout(1_000) });
  return { id, secret };
}

async function addDevice(access: AccessStore): Promise<TestDevice> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id = fixtureId("dev", 1);
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const record = { id, label: "browser", alg: "ed25519", publicKey: spki, createdAtMs: 0 } as const;
  await access.addDevice(record, { signal: AbortSignal.timeout(1_000) });
  return { id, privateKey };
}

async function listen(server: NetServer): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

/** Starts a protocol server on 127.0.0.1 with fresh memory stores, two tokens and a device. */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const clock = createManualClock(1_000_000);
  const logger = createMemoryLogger({ subsystem: "server" });
  const access = createMemoryAccessStore();
  const idempotency = createMemoryIdempotencyStore();
  const server = createProtocolServer({
    http: { host: "127.0.0.1", port: 0 },
    auth: { access },
    idempotency,
    handlers: options.handlers ?? {},
    engine: {
      version: "2026.10.0",
      state: options.state ?? (() => "ready"),
      owner: () => ({ locale: "en", timezone: "UTC" }),
    },
    clock,
    random: createSeededRandom(7),
    logger,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const address = await server.start(AbortSignal.timeout(5_000));
  const ipc = createNetServer((socket) => server.acceptIpc(socket));
  const ipcPort = await listen(ipc);
  const httpPort = address?.port ?? 0;
  return {
    server,
    wsUrl: `ws://127.0.0.1:${String(httpPort)}/ws`,
    ipcUrl: `ws://127.0.0.1:${String(ipcPort)}/ws`,
    origin: `http://127.0.0.1:${String(httpPort)}`,
    httpPort,
    clock,
    logger,
    access,
    idempotency,
    cliToken: await addToken(access, { n: 1, kind: "cli", scopes: cliScopes }),
    mcpToken: await addToken(access, { n: 2, kind: "mcp", scopes: ["read", "propose"] }),
    device: await addDevice(access),
    async close() {
      ipc.close();
      await server.close();
    },
  };
}

/** A device's signature over a challenge's nonce and an origin, as a browser makes it. */
export function proofSignature(device: TestDevice, input: DeviceProofInput): string {
  return sign(null, Buffer.from(deviceProofText(input)), device.privateKey).toString("base64url");
}

/** How a test client reaches the server. */
export interface ClientRoute {
  readonly url: string;
  readonly credential: Credential;
  readonly kind?: ClientKind;
  /** The `Origin` header; a browser always sends one. */
  readonly origin?: string;
  /** Signs a device challenge with this key. */
  readonly device?: TestDevice;
}

/** A `@binference/client` over `ws` sockets, on the test server's clock. */
export function connectClient(test: TestServer, route: ClientRoute): ProtocolClient {
  const origin = route.origin;
  const { device } = route;
  return createProtocolClient({
    operations,
    openSocket: () => new WebSocket(route.url, origin === undefined ? {} : { origin }),
    client: { kind: route.kind ?? "cli", version: "test" },
    credential: route.credential,
    ...(device === undefined || origin === undefined
      ? {}
      : { proveDevice: async (nonce: string) => proofSignature(device, { nonce, origin }) }),
    clock: test.clock,
    random: createSeededRandom(11),
    logger: createMemoryLogger({ subsystem: "client" }),
    limits: { reconnect: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1, budgetMs: 1 } },
  });
}

/** Gathers values as they arrive and settles once `count` of them did. */
export interface Gathered<T> {
  readonly add: (value: T) => void;
  /** Resolves with the first `count` values, in the order they arrived. */
  readonly all: Promise<readonly T[]>;
}

/** Gathers `count` values, such as pushes, for a test to await. */
export function gather<T>(count: number): Gathered<T> {
  const values: T[] = [];
  const settled: ((all: readonly T[]) => void)[] = [];
  const all = new Promise<readonly T[]>((resolve) => {
    settled.push(resolve);
  });
  return {
    add(value) {
      values.push(value);
      if (values.length === count) {
        settled.forEach((resolve) => resolve([...values]));
      }
    },
    all,
  };
}
