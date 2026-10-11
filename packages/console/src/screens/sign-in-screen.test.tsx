// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatterFor, TextProvider } from "../i18n/console-text";
import type { SessionState } from "../session/session-state";
import { SignInScreen } from "./sign-in-screen";

afterEach(cleanup);

type Shown = Exclude<SessionState, { readonly kind: "ready" }>;

function show(state: Shown, retry = vi.fn<() => void>()) {
  render(
    <TextProvider formatter={formatterFor("en", "UTC")}>
      <SignInScreen state={state} retry={retry} />
    </TextProvider>,
  );
  return retry;
}

describe("the sign-in page", () => {
  it("says it pairs the browser while it does", () => {
    show({ kind: "pairing" });
    expect(screen.getByRole("status").textContent).toBe("Pairing this browser with binference");
  });

  it("tells the owner how to get a link when the browser holds no device", () => {
    show({ kind: "signed_out", reason: "no_device" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Run binference console on the machine");
    expect(alert.querySelector("code")?.textContent).toBe("binference console");
  });

  it.each([
    ["used", "This link was used already."],
    ["expired", "This link expired after 10 minutes."],
    ["revoked", "This browser's console device was revoked."],
    ["mini_expired", "This Mini App was opened more than 5 minutes ago."],
  ] as const)("refuses a link that was %s and says why", (reason, words) => {
    show({ kind: "signed_out", reason });
    expect(screen.getByRole("alert").textContent).toContain(words);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers to try again when binference does not answer", () => {
    const retry = show({ kind: "signed_out", reason: "unreachable" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
