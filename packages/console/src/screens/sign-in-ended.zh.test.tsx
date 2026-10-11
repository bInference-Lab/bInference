// @vitest-environment jsdom
import type { ProtocolClient } from "@binference/client";
import { readyFrameSchema } from "@binference/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EngineProvider } from "../connection/engine-context";
import { formatterFor, TextProvider } from "../i18n/console-text";
import { SignInEnded } from "./sign-in-ended";

afterEach(cleanup);

describe("the notice that a sign-in ran out, in Chinese", () => {
  it("asks the owner to open the console again from the bot", () => {
    const error = Object.assign(new Error("expired"), { code: "auth.expired" });
    const client = { status: () => ({ state: "closed", error }) } as unknown as ProtocolClient;
    const ready = readyFrameSchema.parse({
      t: "ready",
      v: 1,
      connection: "con_0190f1c2-3a4b-7c5d-8e6f-000000000002",
      scopes: ["read"],
      engine: { version: "2026.10.0", protocol: 1, state: "ready" },
      owner: { locale: "zh", timezone: "Asia/Shanghai" },
    });
    render(
      <TextProvider formatter={formatterFor("zh", "Asia/Shanghai")}>
        <EngineProvider link={{ client, ready }}>
          <SignInEnded />
        </EngineProvider>
      </TextProvider>,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Mini App 已在打开 12 小时后退出登录。请再次通过机器人的 /console 按钮打开控制台。",
    );
  });
});
