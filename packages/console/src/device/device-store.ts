import type { DeviceAlg } from "./device-key";
import { readStoredDevice } from "./stored-device.schema";

/** The paired device this browser keeps: its id and its private key, never extractable. */
export interface StoredDevice {
  readonly deviceId: string;
  readonly alg: DeviceAlg;
  readonly privateKey: CryptoKey;
}

/** Keeps this browser's one paired device. */
export interface DeviceStore {
  /** The device, or `undefined` before a pairing or after `forget`. */
  load(): Promise<StoredDevice | undefined>;
  /** Keeps the device in place of any earlier one. */
  save(device: StoredDevice): Promise<void>;
  /** Forgets the device, such as after the engine revoked it. */
  forget(): Promise<void>;
}

const databaseName = "binference-console";
const storeName = "device";
const recordKey = "current";

async function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB failed.")),
    );
  });
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(databaseName, 1);
  request.addEventListener("upgradeneeded", () => {
    request.result.createObjectStore(storeName);
  });
  return settle(request);
}

async function run<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase(factory);
  try {
    return await settle(work(database.transaction(storeName, mode).objectStore(storeName)));
  } finally {
    database.close();
  }
}

/**
 * Keeps the paired device in IndexedDB. The private key is stored as the `CryptoKey` itself,
 * which the browser keeps non-extractable: no script, this page's included, can read its bytes.
 */
export function createIndexedDeviceStore(factory: IDBFactory): DeviceStore {
  return {
    async load() {
      return readStoredDevice(await run(factory, "readonly", (store) => store.get(recordKey)));
    },
    async save(device) {
      await run(factory, "readwrite", (store) => store.put(device, recordKey));
    },
    async forget() {
      await run(factory, "readwrite", (store) => store.delete(recordKey));
    },
  };
}
