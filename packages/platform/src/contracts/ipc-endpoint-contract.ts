import assert from "node:assert/strict";
import { once } from "node:events";
import type { Socket } from "node:net";
import type { Result } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { IpcBinding } from "../ipc/ipc-binding.js";
import type { IpcEndpoint } from "../ports.js";

/** Makes an endpoint at an address no other check uses. */
export interface IpcEndpointHarness {
  create(): Promise<IpcEndpoint>;
}

const signal = (): AbortSignal => new AbortController().signal;
const ignore = (): void => undefined;

function valueOf<T>(result: Result<T, string>): T {
  assert.ok(result.ok, `expected a value, got ${result.ok ? "" : result.error}`);
  return result.value;
}

function echo(socket: Socket): void {
  socket.on("data", (chunk: Buffer) => socket.write(chunk));
}

async function exchange(endpoint: IpcEndpoint, text: string): Promise<string> {
  const socket = valueOf(await endpoint.connect(signal()));
  const answered = new Promise<string>((resolve) => {
    socket.once("data", (chunk: Buffer) => resolve(String(chunk)));
  });
  socket.write(text);
  const answer = await answered;
  socket.destroy();
  return answer;
}

async function withBinding(binding: IpcBinding, check: () => Promise<void>): Promise<void> {
  try {
    await check();
  } finally {
    await binding.close();
  }
}

function bindingChecks(harness: IpcEndpointHarness): readonly ContractCheck[] {
  return [
    {
      name: "carries bytes both ways between a client and the listener",
      run: async () => {
        const endpoint = await harness.create();
        const binding = valueOf(await endpoint.bind({ signal: signal(), onSocket: echo }));
        await withBinding(binding, async () => {
          assert.equal(await exchange(endpoint, "ping"), "ping");
        });
      },
    },
    {
      name: "refuses a second listener while the first holds the address",
      run: async () => {
        const endpoint = await harness.create();
        const binding = valueOf(await endpoint.bind({ signal: signal(), onSocket: ignore }));
        await withBinding(binding, async () => {
          const second = await endpoint.bind({ signal: signal(), onSocket: ignore });
          assert.deepEqual(second, { ok: false, error: "in_use" });
        });
      },
    },
    {
      name: "frees the address on close for the next listener",
      run: async () => {
        const endpoint = await harness.create();
        await valueOf(await endpoint.bind({ signal: signal(), onSocket: ignore })).close();
        const next = valueOf(await endpoint.bind({ signal: signal(), onSocket: echo }));
        await withBinding(next, async () => {
          assert.equal(await exchange(endpoint, "again"), "again");
        });
      },
    },
  ];
}

function connectionChecks(harness: IpcEndpointHarness): readonly ContractCheck[] {
  return [
    {
      name: "ends open connections when the listener closes",
      run: async () => {
        const endpoint = await harness.create();
        const binding = valueOf(await endpoint.bind({ signal: signal(), onSocket: ignore }));
        const socket = valueOf(await endpoint.connect(signal()));
        const ended = once(socket, "close");
        await binding.close();
        await ended;
        assert.deepEqual(await endpoint.connect(signal()), { ok: false, error: "unreachable" });
      },
    },
    {
      name: "reports an address nobody listens on as unreachable",
      run: async () => {
        const endpoint = await harness.create();
        assert.deepEqual(await endpoint.connect(signal()), { ok: false, error: "unreachable" });
      },
    },
    {
      name: "does nothing on an aborted signal",
      run: async () => {
        const endpoint = await harness.create();
        const reason = new Error("stopped");
        await assert.rejects(endpoint.connect(AbortSignal.abort(reason)), reason);
        await assert.rejects(
          endpoint.bind({ signal: AbortSignal.abort(reason), onSocket: ignore }),
          reason,
        );
      },
    },
  ];
}

/** The contract every `IpcEndpoint` adapter passes. */
export function ipcEndpointContract(harness: IpcEndpointHarness): readonly ContractCheck[] {
  return [...bindingChecks(harness), ...connectionChecks(harness)];
}
