// @vitest-environment jsdom
import type { ClientStatus, ProtocolClient } from "@binference/client";
import { readyFrameSchema } from "@binference/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EngineProvider } from "../connection/engine-context";
import { formatterFor, TextProvider } from "../i18n/console-text";
import { noFetch } from "../testing/render-signed-in";
import { SignInEnded } from "./sign-in-ended";

afterEach(cleanup);

const ready = readyFrameSchema.parse({
  t: "ready",
  v: 1,
  connection: "con_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  scopes: ["read", "chat", "confirm", "loosen"],
  engine: { version: "2026.10.0", protocol: 1, state: "ready" },
  owner: { locale: "en", timezone: "UTC" },
});

function closedWith(code: string): ClientStatus {
  return { state: "closed", error: Object.assign(new Error(code), { code }) };
}

function renderWith(status: ClientStatus) {
  const client = { status: () => status } as unknown as ProtocolClient;
  return render(
    <TextProvider formatter={formatterFor("en", "UTC")}>
      <EngineProvider link={{ client, ready, fetch: noFetch }}>
        <SignInEnded />
      </EngineProvider>
    </TextProvider>,
  );
}

describe("the notice that a sign-in ran out", () => {
  it("asks the owner to open the console again once the engine ended it as expired", () => {
    renderWith(closedWith("auth.expired"));
    expect(screen.getByRole("alert").textContent).toBe(
      "The Mini App signed out 12 hours after it opened. Open the console again from the bot's /console button.",
    );
  });

  it.each([
    ["a connection that is ready", { state: "ready", ready } as const],
    ["one that closed for another reason", closedWith("auth.revoked")],
  ])("stays silent for %s", (_name, status: ClientStatus) => {
    renderWith(status);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
