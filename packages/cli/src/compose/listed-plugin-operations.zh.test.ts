import { join } from "node:path";
import { createFormatter } from "@binference/i18n";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { cloudRefusals } from "./listed-plugin-harness.js";

let http: SystemHttp;
let registry: FakeNpmRegistry;
let folder: TempFolder;

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
  folder = await createTempFolder("listed-operations-zh-");
});

afterAll(async () => {
  await registry.close();
  await http.close();
  await folder.remove();
});

const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
const wordsOf = (code: string): string => chinese.message(`error.${code}`);

describe("plugin installs on the Cloud composition, in Chinese", () => {
  it("words each refusal of an add in Chinese", async () => {
    const refused = await cloudRefusals({ registry, http, folder: join(folder.path, "refusals") });

    expect(wordsOf(refused.unlisted.code)).toBe(
      "bInference 尚未审核并上架此插件的这个版本，因此无法在 bInference Cloud 上添加或开启。请添加 bInference 已上架的版本。",
    );
    expect(wordsOf(refused.otherHash.code)).toBe(
      "此插件与 bInference 审核的软件包不一致：它与上架条目不符，因此未做任何更改。如已安装，请先移除该插件，再重新添加；如果再次出现，请告知 bInference。",
    );
    expect(wordsOf(refused.otherKey.code)).toBe(
      "此插件的上架条目没有 bInference 的有效签名，因此未做任何更改。请几分钟后重试；如果再次出现，请告知 bInference。",
    );
    expect(wordsOf(refused.revoked.code)).toBe(
      "bInference 已撤销此插件版本的上架条目，因此无法添加或启用。请移除它，或添加 bInference 已上架的版本。",
    );
  });
});
