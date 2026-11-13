import { describe, expect, it } from "vitest";
import { bundledFolders, outsidePackageFolder, type PackedCopy } from "./bundled-packages.js";

const store = "../../node_modules/.pnpm";
const openai = `${store}/openai@7.28.0_ws@8.22.0_zod@4.6.6/node_modules/openai`;
const anthropic = `${store}/@anthropic-ai+sdk@0.131.0_zod@4.6.6/node_modules/@anthropic-ai/sdk`;

function runtimeCopy(change: Partial<PackedCopy> = {}): PackedCopy {
  return {
    folder: "packages/runtime",
    files: ["dist/runtime-process.mjs", "dist/index.mjs"],
    records: {
      "bundle-record/index.json": { files: { "dist/index.mjs": [] } },
      "bundle-record/runtime-process.json": {
        files: {
          "dist/runtime-process.mjs": [
            `${openai}/client.mjs`,
            `${openai}/resources/chat.mjs`,
            `${anthropic}/index.mjs`,
          ],
        },
      },
    },
    ...change,
  };
}

describe("the packages a tarball carries inside its files", () => {
  it("finds a package's folder after the last node_modules, a scope taking one more part", () => {
    expect(outsidePackageFolder(`${openai}/client.mjs`)).toBe(openai);
    expect(outsidePackageFolder(`${anthropic}/core/api.mjs`)).toBe(anthropic);
    expect(outsidePackageFolder("node_modules/a/node_modules/@b/c/d.js")).toBe(
      "node_modules/a/node_modules/@b/c",
    );
    expect(outsidePackageFolder("..\\..\\node_modules\\zod\\index.js")).toBe(
      "../../node_modules/zod",
    );
    expect(outsidePackageFolder("src/index.ts")).toBeUndefined();
    expect(outsidePackageFolder("node_modules/@scope")).toBeUndefined();
  });

  it("reads each package from the records, from the repository's root, once", () => {
    const cli: PackedCopy = {
      folder: "packages/cli",
      files: ["dist/main.mjs"],
      records: { "bundle-record/index.json": { files: { "dist/main.mjs": [`${openai}/a.mjs`] } } },
    };
    expect(bundledFolders([runtimeCopy(), cli])).toEqual({
      folders: [
        "node_modules/.pnpm/@anthropic-ai+sdk@0.131.0_zod@4.6.6/node_modules/@anthropic-ai/sdk",
        "node_modules/.pnpm/openai@7.28.0_ws@8.22.0_zod@4.6.6/node_modules/openai",
      ],
      problems: [],
    });
  });

  it("counts only the files the tarball holds", () => {
    const copy = runtimeCopy({ files: ["dist/index.mjs"] });
    expect(bundledFolders([copy])).toEqual({ folders: [], problems: [] });
  });

  it("counts a font a record names, and needs no record of a file that is not code", () => {
    const font = "../../node_modules/@fontsource-variable/hanken-grotesk/files/latin.woff2";
    const page: PackedCopy = {
      folder: "packages/console",
      files: ["dist/assets/latin.woff2", "dist/assets/index.js.br", "dist/mark.svg"],
      records: { "bundle-record/index.json": { files: { "dist/assets/latin.woff2": [font] } } },
    };
    expect(bundledFolders([page])).toEqual({
      folders: ["node_modules/@fontsource-variable/hanken-grotesk"],
      problems: [],
    });
  });

  it("names a file no record holds, since it could hold anything", () => {
    const copy = runtimeCopy({ files: ["dist/index.mjs", "dist/agent.worker.mjs"] });
    expect(bundledFolders([copy]).problems).toEqual([
      "packages/runtime/dist/agent.worker.mjs is in no bundle record: build packages/runtime again.",
    ]);
  });

  it("names a file two records hold, as an old record left beside a new one", () => {
    const records = {
      ...runtimeCopy().records,
      "bundle-record/old.json": { files: { "dist/index.mjs": [] } },
    };
    expect(bundledFolders([runtimeCopy({ records })]).problems).toEqual([
      "packages/runtime/dist/index.mjs is in bundle-record/index.json and bundle-record/old.json: " +
        "remove packages/runtime/bundle-record and build again.",
    ]);
  });
});
