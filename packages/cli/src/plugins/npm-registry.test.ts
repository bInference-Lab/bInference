import { BinferenceError, type DownloadRequest, type HttpDownload } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createNpmRegistry } from "./npm-registry.js";

const signal = AbortSignal.timeout(10_000);
const integrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;

// A registry that answers each URL from a table, recording what it was asked and how much it
// allowed.
function downloadFrom(answers: Readonly<Record<string, object | Error>>) {
  const asked: DownloadRequest[] = [];
  const download: HttpDownload = {
    download: async (request) => {
      asked.push(request);
      const answer = answers[request.url];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer === undefined
        ? { status: 404, headers: {}, bytes: new Uint8Array() }
        : { status: 200, headers: {}, bytes: new TextEncoder().encode(JSON.stringify(answer)) };
    },
  };
  return { download, asked };
}

const base = "https://registry.npmjs.org";

describe("npm's registry", () => {
  it("reads a scoped package's version with its slash as %2f, a megabyte at most", async () => {
    const document = {
      name: "@fear/index",
      version: "1.2.0",
      dist: { integrity, tarball: `${base}/@fear/index/-/index-1.2.0.tgz` },
    };
    const { download, asked } = downloadFrom({ [`${base}/@fear%2findex/1.2.0`]: document });

    await expect(
      createNpmRegistry({ download, base }).version("@fear/index", "1.2.0", signal),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        name: "@fear/index",
        version: "1.2.0",
        integrity,
        tarball: `${base}/@fear/index/-/index-1.2.0.tgz`,
      },
    });
    expect(asked.map(({ maxBytes }) => maxBytes)).toStrictEqual([1024 * 1024]);
  });

  it("reads no tarball from another origin than its own", async () => {
    const { download, asked } = downloadFrom({});
    const version = {
      name: "fear-index",
      version: "1.2.0",
      integrity,
      tarball: "https://evil.example.com/x.tgz",
    };

    await expect(
      createNpmRegistry({ download, base }).tarball(version, signal),
    ).resolves.toStrictEqual({
      ok: false,
      failure: { reason: "bad_answer" },
    });
    expect(asked).toStrictEqual([]);
  });

  it("answers an answer too large as bad_answer, and a request with no answer as unreachable", async () => {
    const tooLarge = new BinferenceError({ code: "http.answer_too_large", message: "Too large." });
    const unreachable = new BinferenceError({ code: "http.unreachable", message: "No answer." });
    const registry = createNpmRegistry({
      download: downloadFrom({
        [`${base}/big/1.0.0`]: tooLarge,
        [`${base}/away/1.0.0`]: unreachable,
      }).download,
      base,
    });

    await expect(registry.version("big", "1.0.0", signal)).resolves.toStrictEqual({
      ok: false,
      failure: { reason: "bad_answer" },
    });
    await expect(registry.version("away", "1.0.0", signal)).resolves.toStrictEqual({
      ok: false,
      failure: { reason: "registry_unreachable" },
    });
  });

  it("refuses a document whose integrity is not one SHA-512", async () => {
    const document = {
      name: "fear-index",
      version: "1.2.0",
      dist: { integrity: "sha1-abc", tarball: `${base}/x.tgz` },
    };
    const { download } = downloadFrom({ [`${base}/fear-index/1.2.0`]: document });

    await expect(
      createNpmRegistry({ download, base }).version("fear-index", "1.2.0", signal),
    ).resolves.toStrictEqual({
      ok: false,
      failure: { reason: "bad_answer" },
    });
  });
});
