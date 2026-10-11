// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatterFor, TextProvider } from "../i18n/console-text";
import { SignInScreen } from "./sign-in-screen";

afterEach(cleanup);

describe("the sign-in page in Chinese", () => {
  it("says a used link was refused, in Chinese", () => {
    render(
      <TextProvider formatter={formatterFor("zh", "UTC")}>
        <SignInScreen state={{ kind: "signed_out", reason: "used" }} retry={vi.fn<() => void>()} />
      </TextProvider>,
    );
    expect(screen.getByRole("heading").textContent).toBe("登录控制台");
    expect(screen.getByRole("alert").textContent).toContain("此链接已被使用");
  });

  it("says a Mini App opened too long ago must be opened again, in Chinese", () => {
    render(
      <TextProvider formatter={formatterFor("zh", "UTC")}>
        <SignInScreen
          state={{ kind: "signed_out", reason: "mini_expired" }}
          retry={vi.fn<() => void>()}
        />
      </TextProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("已打开超过 5 分钟");
  });
});
