import type { Formatter } from "@binference/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EngineProvider } from "../connection/engine-context";
import { formatterFor, localeOf, TextProvider, wordsOf } from "../i18n/console-text";
import { readIntentQuery } from "../push/card-push.schema";
import { type ConsolePush, ConsolePushProvider } from "../push/console-push";
import { SignInScreen } from "../screens/sign-in-screen";
import type { SessionState } from "../session/session-state";
import { useSession } from "../session/use-session";
import type { ConsoleBrowser } from "./console-browser";
import { ConsoleRoutes } from "./console-router";

function basepathOf(pathname: string): string {
  return pathname === "/mini" || pathname.startsWith("/mini/") ? "/mini" : "/";
}

interface SessionProps {
  readonly browser: ConsoleBrowser;
  readonly before: Formatter;
  readonly retry: () => void;
}

// Browser push, and the card a notification opened: from the address, then from each click while
// the page is open.
function useConsolePushOf(browser: ConsoleBrowser): ConsolePush {
  const [focus, setFocus] = useState(() => readIntentQuery(browser.search));
  useEffect(() => browser.onCardClick(setFocus), [browser]);
  return useMemo(
    () => ({
      ...(browser.push === undefined ? {} : { push: browser.push }),
      ...(focus === undefined ? {} : { focus }),
    }),
    [browser, focus],
  );
}

interface ReadyProps {
  readonly session: Extract<SessionState, { readonly kind: "ready" }>;
  readonly browser: ConsoleBrowser;
  readonly push: ConsolePush;
}

// The signed-in console: its queries, its link to the engine and its screens.
function ReadyConsole(props: ReadyProps): React.JSX.Element {
  const { session, browser } = props;
  const [queries] = useState(() => new QueryClient());
  const { client, ready } = session;
  const link = useMemo(() => ({ client, ready, fetch: browser.fetch }), [client, ready, browser]);
  return (
    <QueryClientProvider client={queries}>
      <EngineProvider link={link}>
        <ConsolePushProvider value={props.push}>
          <ConsoleRoutes basepath={basepathOf(browser.pathname)} />
        </ConsolePushProvider>
      </EngineProvider>
    </QueryClientProvider>
  );
}

// One attempt to sign in and the console it opens; a retry mounts a new one.
function ConsoleSession(props: SessionProps): React.JSX.Element {
  const { browser, before } = props;
  const label = wordsOf(before)("console.device.label", { platform: browser.platform });
  const state = useSession(browser, label);
  const push = useConsolePushOf(browser);
  const owner = state.kind === "ready" ? state.ready.owner : undefined;
  const text = useMemo(
    () => (owner === undefined ? before : formatterFor(owner.locale, owner.timezone)),
    [before, owner],
  );
  useEffect(() => {
    document.documentElement.lang = text.locale === "zh" ? "zh-CN" : "en";
  }, [text]);
  return (
    <TextProvider formatter={text}>
      {state.kind === "ready" ? (
        <ReadyConsole session={state} browser={browser} push={push} />
      ) : (
        <SignInScreen state={state} retry={props.retry} />
      )}
    </TextProvider>
  );
}

/** The console: the sign-in page until the engine says `ready`, then the screens. */
export function App(props: { readonly browser: ConsoleBrowser }): React.JSX.Element {
  const { browser } = props;
  const before = useMemo(() => formatterFor(localeOf(browser.language), "UTC"), [browser]);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return <ConsoleSession key={attempt} browser={browser} before={before} retry={retry} />;
}
