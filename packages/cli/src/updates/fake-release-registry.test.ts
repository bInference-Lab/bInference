import { httpDownloadContract } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakeReleaseRegistry } from "./fake-release-registry.js";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

function subject() {
  const fake = createFakeReleaseRegistry();
  fake.release("2026.11.0", { bytes: png });
  return {
    download: fake.download,
    bytesUrl: `${fake.registry}/binference/-/binference-2026.11.0.tgz`,
    missingUrl: `${fake.registry}/binference/-/binference-2026.12.0.tgz`,
    unreachableUrl: "https://unreachable.test/binference",
  };
}

describe("the fake release registry", () => {
  it.each(httpDownloadContract({ create: subject }))(
    "follows the download contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
