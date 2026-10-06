import { err, ok, type Result } from "@binference/core";
import type { DeviceRecord } from "../access/device-record.js";
import type { PairCodeRecord, PairCodeUse } from "../access/pair-code-record.js";
import type { TokenRecord } from "../access/token-record.js";
import type { AccessStore } from "../ports.js";
import { byCreation, memoryCall } from "./memory-call.js";

interface Row {
  readonly id: string;
  readonly createdAtMs: number;
}

// One table of rows by id, behind functions, so the store methods never take a mutable map.
interface Rows<T extends Row> {
  readonly add: (row: T, isTaken: (stored: T) => boolean) => Result<T, "exists">;
  readonly find: (isWanted: (stored: T) => boolean) => T | undefined;
  readonly list: () => readonly T[];
  readonly change: (id: string, update: (row: T) => T) => Result<T, "not_found">;
}

function createRows<T extends Row>(): Rows<T> {
  const rows = new Map<string, T>();
  return {
    add(row, isTaken) {
      if (rows.has(row.id) || [...rows.values()].some(isTaken)) {
        return err("exists");
      }
      rows.set(row.id, structuredClone(row));
      return ok(structuredClone(row));
    },
    find: (isWanted) => structuredClone([...rows.values()].find(isWanted)),
    list: () => structuredClone([...rows.values()].toSorted(byCreation)),
    change(id, update) {
      const row = rows.get(id);
      if (row === undefined) {
        return err("not_found");
      }
      const changed = update(row);
      rows.set(id, changed);
      return ok(structuredClone(changed));
    },
  };
}

const later = (stored: number | undefined, atMs: number): number => Math.max(stored ?? atMs, atMs);

function tokenMethods(): Pick<
  AccessStore,
  "addToken" | "findToken" | "listTokens" | "markTokenUsed" | "revokeToken"
> {
  const tokens = createRows<TokenRecord>();
  return {
    addToken: async (token, call) =>
      memoryCall(call, () => tokens.add(token, (stored) => stored.secretHash === token.secretHash)),
    findToken: async (secretHash, call) =>
      memoryCall(call, () => tokens.find((token) => token.secretHash === secretHash)),
    listTokens: async (call) => memoryCall(call, () => tokens.list()),
    markTokenUsed: async (use, call) =>
      memoryCall(call, () =>
        tokens.change(use.id, (row) => ({
          ...row,
          lastUsedAtMs: later(row.lastUsedAtMs, use.atMs),
        })),
      ),
    revokeToken: async (revoke, call) =>
      memoryCall(call, () =>
        tokens.change(revoke.id, (row) => ({
          ...row,
          revokedAtMs: row.revokedAtMs ?? revoke.atMs,
        })),
      ),
  };
}

function deviceMethods(): Pick<
  AccessStore,
  "addDevice" | "findDevice" | "listDevices" | "markDeviceSeen" | "revokeDevice"
> {
  const devices = createRows<DeviceRecord>();
  return {
    addDevice: async (device, call) => memoryCall(call, () => devices.add(device, () => false)),
    findDevice: async (id, call) => memoryCall(call, () => devices.find((row) => row.id === id)),
    listDevices: async (call) => memoryCall(call, () => devices.list()),
    markDeviceSeen: async (seen, call) =>
      memoryCall(call, () =>
        devices.change(seen.id, (row) => ({
          ...row,
          lastSeenAtMs: later(row.lastSeenAtMs, seen.atMs),
        })),
      ),
    revokeDevice: async (revoke, call) =>
      memoryCall(call, () =>
        devices.change(revoke.id, (row) => ({
          ...row,
          revokedAtMs: row.revokedAtMs ?? revoke.atMs,
        })),
      ),
  };
}

function pairCodeMethods(): Pick<AccessStore, "addPairCode" | "usePairCode"> {
  const codes = new Map<string, PairCodeRecord>();
  const use = (attempt: PairCodeUse): Result<PairCodeRecord, "unknown" | "expired" | "used"> => {
    const code = codes.get(attempt.codeHash);
    if (code === undefined) {
      return err("unknown");
    }
    if (code.usedAtMs !== undefined) {
      return err("used");
    }
    if (attempt.atMs >= code.expiresAtMs) {
      return err("expired");
    }
    const used = { ...code, usedAtMs: attempt.atMs };
    codes.set(attempt.codeHash, used);
    return ok(structuredClone(used));
  };
  return {
    addPairCode: async (code, call) =>
      memoryCall(call, () => {
        if (codes.has(code.codeHash)) {
          return err("exists");
        }
        codes.set(code.codeHash, structuredClone(code));
        return ok(structuredClone(code));
      }),
    usePairCode: async (attempt, call) => memoryCall(call, () => use(attempt)),
  };
}

/** Creates an empty in-memory {@link AccessStore} for tests. */
export function createMemoryAccessStore(): AccessStore {
  return { ...tokenMethods(), ...deviceMethods(), ...pairCodeMethods() };
}
