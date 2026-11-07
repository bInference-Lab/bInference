import { describe, expect, it } from "vitest";
import { restartedNotice } from "./restart-notice.js";

describe("the notice after binference restarted itself", () => {
  it("names the settings a restart applied, or none when the owner asked for it", () => {
    expect([
      restartedNotice(["engine.port", "models.main"]).data,
      restartedNotice([]).data,
    ]).toMatchObject([
      { key: "notice.restartedForConfig", values: { changed: "engine.port, models.main" } },
      { key: "notice.restarted", values: {} },
    ]);
  });
});
