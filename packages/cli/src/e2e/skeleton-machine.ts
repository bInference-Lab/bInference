import { dirname } from "node:path";
import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { cliTokenFile } from "../compose/cli-token.js";
import { engineEndpoint, platformOf } from "../compose/engine-locations.js";
import {
  type ComposedSkeleton,
  composeSkeleton,
  type SkeletonComposition,
  skeletonSecrets,
} from "../compose/test-skeleton.js";
import { connectClient, hostOn, noPermissions, type TestMachine } from "./test-host.js";

/** The skeleton serving a machine's state folder, as `binference start` would serve it. */
export interface ServedSkeleton extends ComposedSkeleton {
  /** The owner's CLI signed in over the IPC endpoint, for a test to propose through. */
  readonly client: ProtocolClient;
  /** Closes the client, the IPC endpoint and the server. */
  close(): Promise<void>;
}

/**
 * Serves the skeleton composition on the machine's own IPC endpoint and writes its CLI token to
 * `auth/cli.token`, so `runCli` on that machine reaches an engine with a paper agent, its wallet
 * and the fake venue, as it reaches a started one.
 */
export async function serveSkeleton(
  machine: TestMachine,
  composition: SkeletonComposition,
): Promise<ServedSkeleton> {
  const skeleton = await composeSkeleton(composition.parts());
  const platform = platformOf(hostOn(machine, []));
  const files = { permissions: noPermissions, signal: new AbortController().signal };
  const tokenFile = cliTokenFile(platform.stateFolder);
  await ensurePrivateFolder(dirname(tokenFile), files);
  await writePrivateFile(tokenFile, `${skeletonSecrets.cli}\n`, files);
  const bound = await engineEndpoint(platform).bind({
    signal: files.signal,
    onSocket: (socket) => skeleton.composed.server.acceptIpc(socket),
  });
  if (!bound.ok) {
    throw new BinferenceError({ code: "test.ipc_in_use", message: "The IPC endpoint is taken." });
  }
  const client = await connectClient(machine);
  return {
    ...skeleton,
    client,
    async close() {
      client.close();
      await bound.value.close();
      await skeleton.composed.server.close();
    },
  };
}
