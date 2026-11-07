import { join } from "node:path";
import { BinferenceError, type HttpDownload } from "@binference/core";
import { viewImageSourceContract } from "@binference/engine/testing";
import { ensurePrivateFolder, realFilePath, writePrivateFile } from "@binference/platform";
import { createFileLink, createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { viewImagesOf } from "./compose-view-images.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const folders: TempFolder[] = [];
const permissions = {
  restrictFolder: async () => Promise.resolve(),
  restrictFile: async () => Promise.resolve(),
  syncFolder: async () => Promise.resolve(),
};
const signal = new AbortController().signal;
const files = { permissions, signal };

// Answers the one public address with the image, and refuses private hosts as the guard does.
const download: HttpDownload = {
  download: async ({ url }) => {
    if (url.includes(".private.invalid")) {
      throw new BinferenceError({ code: "http.private_address", message: "Private." });
    }
    const found = url === "https://example.com/chart.png";
    return Promise.resolve({
      status: found ? 200 : 404,
      headers: {},
      bytes: found ? png : new Uint8Array(),
    });
  },
};

// A home folder with an image, and binference's state folder inside it with a key and a workspace.
async function machine() {
  const folder = await createTempFolder("view-");
  folders.push(folder);
  const home = await realFilePath(folder.path, signal);
  const state = join(home, ".binference");
  await ensurePrivateFolder(join(state, "keys"), files);
  await ensurePrivateFolder(join(state, "workspace"), files);
  await writePrivateFile(join(home, "shot.png"), png, files);
  await writePrivateFile(join(state, "keys", "agent-key"), "secret", files);
  await writePrivateFile(join(state, "workspace", "chart.png"), png, files);
  const source = viewImagesOf({
    download,
    walled: { roots: [state], open: [join(state, "workspace")] },
    homeDir: home,
  });
  return { home, state, source };
}

const live = () => ({ signal: new AbortController().signal });

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe("the images the agent views on this machine", () => {
  it.each(
    viewImageSourceContract({
      create: async () => {
        const { source } = await machine();
        return {
          source,
          held: { place: { path: "~/shot.png" }, bytes: png },
          missing: { path: "~/none.png" },
          walled: { path: "~/.binference/keys/agent-key" },
          private: { url: "http://router.private.invalid/cam.png" },
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads a public address and a file in the workspace", async () => {
    const { source } = await machine();
    await expect(
      source.read({ url: "https://example.com/chart.png" }, live()),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      source.read({ path: "~/.binference/workspace/chart.png" }, live()),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses a link that leads into binference's folder", async () => {
    const { home, state, source } = await machine();
    await createFileLink(join(state, "keys", "agent-key"), join(home, "innocent.png"));
    await expect(source.read({ path: join(home, "innocent.png") }, live())).resolves.toStrictEqual({
      ok: false,
      error: "walled",
    });
  });

  it("answers an address that is not there as not found", async () => {
    const { source } = await machine();
    await expect(
      source.read({ url: "https://example.com/gone.png" }, live()),
    ).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });
});
