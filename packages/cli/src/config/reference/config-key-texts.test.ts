import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { configKeyTexts } from "./config-key-texts.js";
import { renderConfigReference } from "./config-reference.js";

describe("configKeyTexts", () => {
  const texts = configKeyTexts();

  it("keys each described key by its path, and each machine-dependent default after a colon", () => {
    expect(texts.get("configKeys.engine.port")).toBe("The console, Mini App and WebSocket port.");
    expect(texts.get("configKeys.engine")).toBe("The engine process.");
    expect(texts.get("configKeys.owner.locale:default")).toBe("from the OS");
    expect(texts.get("configKeys.chains.rpc.<chain>.urls")).toBe("Extra or replacement RPCs.");
  });

  it("holds every text the English reference shows, and no other", () => {
    const reference = renderConfigReference(createFormatter({ locale: "en", timeZone: "UTC" }));

    expect([...texts.values()].filter((text) => !reference.includes(text))).toStrictEqual([]);
  });
});
