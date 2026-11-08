import { describe, expect, it } from "vitest";
import { browserDriverContract } from "../contracts/browser-driver-contract.js";
import { createFakeBrowserDriver } from "./fake-browser-driver.js";

const page = {
  url: "https://example.test/",
  title: "Example",
  word: "harbour",
  clickedTitle: "Pressed",
};

describe("the fake browser driver", () => {
  it.each(
    browserDriverContract({
      create: async () =>
        Promise.resolve({
          driver: createFakeBrowserDriver({
            pages: {
              [page.url]: { title: page.title, text: "The harbour.", clickedTitle: "Pressed" },
            },
            refused: ["http://10.0.0.1/"],
          }),
          page,
          refusedUrl: "http://10.0.0.1/",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("finds no browser when told it is missing", async () => {
    const driver = createFakeBrowserDriver({ pages: {}, missing: true });
    const signal = new AbortController().signal;
    await expect(driver.run({ action: "start" }, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });
});
