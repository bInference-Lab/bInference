// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { pluginsAnswers, pluginsFixture } from "../testing/plugins-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { PluginsScreen } from "./plugins-screen";

afterEach(cleanup);

// The plugin card whose title names `name`.
function itemOf(name: string): HTMLElement {
  const list = screen.getByRole("list", { name: "Installed plugins" });
  const item = within(list)
    .getAllByRole("listitem")
    .find((each) => each.parentElement === list && within(each).queryByText(name) !== null);
  if (item === undefined) {
    throw new Error(`Expected plugin ${name} in the list.`);
  }
  return item;
}

function opsOf(calls: readonly { readonly op: string; readonly args: object }[], op: string) {
  return calls.filter((call) => call.op === op).map(({ args }) => args);
}

describe("the plugins screen", () => {
  it("shows each plugin's review, provenance, publisher and pin, and whether it runs", async () => {
    renderSignedIn(<PluginsScreen />, { client: fakeClient(pluginsAnswers).client });
    await settle();
    const on = itemOf("fear-index");
    expect(within(on).getByText("On")).toBeDefined();
    expect(within(on).getByText("Community")).toBeDefined();
    const hosts = within(on).getByRole("list", { name: "It may reach 1 host:" });
    expect(within(hosts).getByText("api.alternative.me")).toBeDefined();
    const tools = within(on).getByRole("list", { name: "It adds 1 tool:" });
    expect(within(tools).getByText("fear_index")).toBeDefined();
    const settings = within(on).getByRole("list", {
      name: "It reads 1 setting, under plugins.fear-index in config.json5:",
    });
    expect(within(settings).getByText("window")).toBeDefined();
    expect(within(on).getByText("npm provenance: checked")).toBeDefined();
    expect(within(on).getByText("Publisher: github.com/owner/fear-index")).toBeDefined();
    expect(on.textContent).toContain(
      `From npm:fear-index@1.2.0, pinned to SHA-256 ${"a".repeat(64)}.`,
    );
    expect(within(on).getByText("Added Nov 3, 2026, 09:30:00.")).toBeDefined();
  });

  it("says why each plugin that does not run is off, and where a listed one stands", async () => {
    renderSignedIn(<PluginsScreen />, { client: fakeClient(pluginsAnswers).client });
    await settle();
    const crashed = itemOf("whale-feed");
    expect(within(crashed).getByText("Off")).toBeDefined();
    expect(
      within(crashed).getByText(
        "It crashed 5 times in 10 minutes, so binference stopped it. Enable it to start it again.",
      ),
    ).toBeDefined();
    expect(within(crashed).getByText("It may reach 2 hosts:")).toBeDefined();
    expect(within(crashed).getByText("npm provenance: none")).toBeDefined();
    expect(within(crashed).getByText("Publisher: whaler")).toBeDefined();
    expect(
      within(itemOf("echo-feed")).getByText(
        "Its files are no longer the ones you added, so it does not start. Remove it and add it again in the terminal.",
      ),
    ).toBeDefined();
    expect(
      within(itemOf("chain-news")).getByText(
        "Held: binference cannot check bInference's plugin listings right now. It starts again on its own.",
      ),
    ).toBeDefined();
  });

  it("disables a plugin at once and shows how the engine answered", async () => {
    const engine = fakeClient(pluginsAnswers);
    renderSignedIn(<PluginsScreen />, { client: engine.client });
    await settle();
    fireEvent.click(within(itemOf("fear-index")).getByRole("button", { name: "Disable" }));
    await settle();
    expect(opsOf(engine.calls, "plugin/disable")).toStrictEqual([
      { plugin: pluginsFixture.fearIndex },
    ]);
    expect(
      within(itemOf("fear-index")).getByText(
        "fear-index is off. The agent can no longer call its tools.",
      ),
    ).toBeDefined();
  });

  it("asks once more before it enables a plugin, and enables nothing on Keep it off", async () => {
    const engine = fakeClient(pluginsAnswers);
    renderSignedIn(<PluginsScreen />, { client: engine.client });
    await settle();
    const crashed = itemOf("whale-feed");
    fireEvent.click(within(crashed).getByRole("button", { name: "Enable" }));
    expect(
      within(crashed).getByText(
        "Enable whale-feed? Its tools reach the agent from its next turn, and while it is on, auto mode asks you before every trade.",
      ),
    ).toBeDefined();
    fireEvent.click(within(crashed).getByRole("button", { name: "Keep it off" }));
    expect(opsOf(engine.calls, "plugin/enable")).toStrictEqual([]);
    fireEvent.click(within(crashed).getByRole("button", { name: "Enable" }));
    fireEvent.click(within(crashed).getByRole("button", { name: "Enable it" }));
    await settle();
    expect(opsOf(engine.calls, "plugin/enable")).toStrictEqual([
      { plugin: pluginsFixture.whaleFeed },
    ]);
    expect(
      within(itemOf("whale-feed")).getByText(
        "whale-feed is on. Its tools reach the agent from its next turn.",
      ),
    ).toBeDefined();
  });

  it("shows an engine's refusal in its code's words", async () => {
    const refused = Object.assign(new Error("plugin/enable"), { code: "plugin.listing_revoked" });
    const engine = fakeClient({
      ...pluginsAnswers,
      "plugin/enable": async () => Promise.reject(refused),
    });
    renderSignedIn(<PluginsScreen />, { client: engine.client });
    await settle();
    const crashed = itemOf("whale-feed");
    fireEvent.click(within(crashed).getByRole("button", { name: "Enable" }));
    fireEvent.click(within(crashed).getByRole("button", { name: "Enable it" }));
    await settle();
    expect(within(itemOf("whale-feed")).getByRole("alert").textContent).toBe(
      "Nothing changed: bInference revoked the listing of this plugin version, so it cannot be added or turned on. Remove it, or add a version bInference lists.",
    );
  });

  it("offers a connection without admin no Enable, and tells it where to enable", async () => {
    renderSignedIn(<PluginsScreen />, {
      client: fakeClient(pluginsAnswers).client,
      scopes: ["read", "chat", "confirm", "loosen"],
    });
    await settle();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(within(itemOf("fear-index")).getByRole("button", { name: "Disable" })).toBeDefined();
    expect(itemOf("whale-feed").textContent).toContain(
      "This connection can disable a plugin, but not enable one.",
    );
  });

  it("says no plugin is installed when the list is empty", async () => {
    const engine = fakeClient({ "plugin/list": () => ({ items: [] }) });
    renderSignedIn(<PluginsScreen />, { client: engine.client });
    await settle();
    expect(screen.getByText(/^No community plugin is installed\./u)).toBeDefined();
    expect(screen.queryByRole("list", { name: "Installed plugins" })).toBeNull();
  });
});
