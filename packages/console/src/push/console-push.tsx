import { createContext, type ReactNode, useContext } from "react";
import type { BrowserPush } from "./browser-push";

/** What the screens read of browser push: the Push API, and the card a notification opened. */
export interface ConsolePush {
  /** Browser push, where this browser and page have it; the Mini App never does. */
  readonly push?: BrowserPush;
  /** The intent whose card a notification opened, to show first. */
  readonly focus?: string;
}

const PushContext = createContext<ConsolePush>({});

/** Gives the screens below it browser push and the card a notification opened. */
export function ConsolePushProvider(props: {
  readonly value: ConsolePush;
  readonly children: ReactNode;
}): React.JSX.Element {
  return <PushContext value={props.value}>{props.children}</PushContext>;
}

/** Browser push and the card a notification opened; neither outside a provider. */
export function useConsolePush(): ConsolePush {
  return useContext(PushContext);
}
