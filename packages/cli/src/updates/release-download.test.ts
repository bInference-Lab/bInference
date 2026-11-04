import { describe, expect, it } from "vitest";
import { createNpmRegistry } from "../plugins/npm-registry.js";
import { createFakeReleaseRegistry } from "./fake-release-registry.js";
import { downloadRelease } from "./release-download.js";

const live = (): AbortSignal => new AbortController().signal;

function partsOn(fake: ReturnType<typeof createFakeReleaseRegistry>) {
  const registry = createNpmRegistry({ download: fake.download, base: fake.registry });
  return { registry, verify: fake.verifier };
}

describe("a release's download", () => {
  it("answers the tarball of binference's own release build", async () => {
    const fake = createFakeReleaseRegistry();
    const bytes = fake.release("2026.12.0");

    await expect(downloadRelease(partsOn(fake), "2026.12.0", live())).resolves.toStrictEqual({
      ok: true,
      value: bytes,
    });
  });

  it("refuses a release with no provenance, or built by another repository", async () => {
    const fake = createFakeReleaseRegistry();
    fake.release("2026.12.0", { provenance: "none" });
    fake.release("2026.12.1", { provenance: "other" });

    expect([
      await downloadRelease(partsOn(fake), "2026.12.0", live()),
      await downloadRelease(partsOn(fake), "2026.12.1", live()),
    ]).toStrictEqual([
      { ok: false, error: "provenance_failed" },
      { ok: false, error: "provenance_failed" },
    ]);
  });

  it("refuses the release workflow run from a branch, and another workflow of the repository", async () => {
    const fake = createFakeReleaseRegistry();
    fake.release("2026.12.0", { provenance: "branch" });
    fake.release("2026.12.1", { provenance: "workflow" });

    expect([
      await downloadRelease(partsOn(fake), "2026.12.0", live()),
      await downloadRelease(partsOn(fake), "2026.12.1", live()),
    ]).toStrictEqual([
      { ok: false, error: "provenance_failed" },
      { ok: false, error: "provenance_failed" },
    ]);
  });

  it("refuses a tarball that is not the one the release's document names", async () => {
    const fake = createFakeReleaseRegistry();
    fake.release("2026.12.0", { isTampered: true });

    await expect(downloadRelease(partsOn(fake), "2026.12.0", live())).resolves.toStrictEqual({
      ok: false,
      error: "hash_mismatch",
    });
  });

  it("refuses a bundle the verifier does not verify, and a version npm does not hold", async () => {
    const fake = createFakeReleaseRegistry();
    fake.release("2026.12.0");
    const unverified = {
      ...partsOn(fake),
      verify: async () => ({ ok: false, error: "unverified" }) as const,
    };

    expect([
      await downloadRelease(unverified, "2026.12.0", live()),
      await downloadRelease(partsOn(fake), "2026.12.9", live()),
    ]).toStrictEqual([
      { ok: false, error: "provenance_failed" },
      { ok: false, error: "not_published" },
    ]);
  });
});
