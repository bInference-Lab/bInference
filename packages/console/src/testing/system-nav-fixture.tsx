import { within } from "@testing-library/react";
import { ConsoleRoutes } from "../app/console-router";
import { fakeClient } from "./fake-client";
import { logsAnswers } from "./logs-fixture";
import { pluginsAnswers } from "./plugins-fixture";
import { renderSignedIn, settle } from "./render-signed-in";
import { skillsAnswers } from "./skills-fixture";

/** Opens the whole console at `path` over an engine that answers the system pages. */
export async function systemNavAt(path: string, locale: "en" | "zh"): Promise<void> {
  globalThis.history.replaceState(null, "", path);
  const { client } = fakeClient({ ...skillsAnswers, ...pluginsAnswers, ...logsAnswers });
  renderSignedIn(<ConsoleRoutes basepath="/" />, { client, locale });
  await settle();
}

/** The names of the links in `nav`, in the order they show. */
export function linkNames(nav: HTMLElement): readonly string[] {
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent);
}
