import type { ProtocolClient } from "@binference/client";
import type { MessageLocale } from "@binference/i18n";
import type { Scope } from "@binference/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { Fetcher } from "../app/console-browser";
import { EngineProvider } from "../connection/engine-context";
import { formatterFor, TextProvider } from "../i18n/console-text";
import { consoleScopes, readyWith } from "./fake-client";

/** A fetcher that answers nothing: a screen under test that sends a request fails. */
export const noFetch: Fetcher = async () => Promise.reject(new Error("No request is expected."));

/** Lets React Query's timers and the answers' promises run, as the browser would between frames. */
export async function settle(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(10));
  await act(async () => vi.advanceTimersByTimeAsync(10));
}

/** What a signed-in screen renders over. */
export interface SignedInOptions {
  readonly client: ProtocolClient;
  readonly scopes?: readonly Scope[];
  readonly fetch?: Fetcher;
  readonly locale?: MessageLocale;
}

/** Renders a signed-in screen in the locale, English unless set, in UTC, over a fake client. */
export function renderSignedIn(page: ReactNode, options: SignedInOptions): RenderResult {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const locale = options.locale ?? "en";
  const link = {
    client: options.client,
    ready: readyWith(options.scopes ?? consoleScopes, locale),
    fetch: options.fetch ?? noFetch,
  };
  return render(
    <TextProvider formatter={formatterFor(locale, "UTC")}>
      <QueryClientProvider client={queries}>
        <EngineProvider link={link}>{page}</EngineProvider>
      </QueryClientProvider>
    </TextProvider>,
  );
}
