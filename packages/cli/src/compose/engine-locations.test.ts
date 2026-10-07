import {
  createTempFolder,
  ipcEndpointContract,
  type TempFolder,
} from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { engineEndpoint, engineLogFile, folderPipeId, platformOf } from "./engine-locations.js";

const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function platformInTempFolder() {
  const folder = await createTempFolder("bnf-ep-");
  folders.push(folder);
  return platformOf({ env: { BINFERENCE_HOME: folder.path } });
}

describe("the engine's locations", () => {
  it.each(
    ipcEndpointContract({ create: async () => engineEndpoint(await platformInTempFolder()) }),
  )(
    "give an IPC endpoint that follows the contract: $name",
    { timeout: 60_000 },
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("names a state folder's pipes the same way whatever the case of its path", () => {
    const id = folderPipeId("D:\\State\\Owner");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(folderPipeId("d:\\state\\owner")).toBe(id);
    expect(folderPipeId("D:\\State\\Other")).not.toBe(id);
  });

  it("keeps the engine's log in the state folder's logs folder", async () => {
    const platform = await platformInTempFolder();
    expect(engineLogFile(platform).startsWith(platform.stateFolder.logs)).toBe(true);
    expect(engineLogFile(platform).endsWith("engine.log")).toBe(true);
  });
});
