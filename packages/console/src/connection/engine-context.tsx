import type { ProtocolClient } from "@binference/client";
import type { ReadyFrame } from "@binference/protocol";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { Fetcher } from "../app/console-browser";
import { createTopicFanout, type TopicFanout } from "./topic-fanout";

/** The signed-in client, the engine's `ready`, and requests to the page's own origin. */
export interface EngineLink {
  readonly client: ProtocolClient;
  readonly ready: ReadyFrame;
  /** Sends a request to the engine's HTTP routes, such as an image to its upload ticket. */
  readonly fetch: Fetcher;
}

/** What every console screen reaches the engine with: the link, and its shared push topics. */
export interface SignedInEngine extends EngineLink {
  readonly topics: TopicFanout;
}

const EngineContext = createContext<SignedInEngine | undefined>(undefined);

/** Gives the screens below it the signed-in client. */
export function EngineProvider(props: {
  readonly link: EngineLink;
  readonly children: ReactNode;
}): React.JSX.Element {
  const { link } = props;
  const topics = useMemo(() => createTopicFanout(link.client), [link.client]);
  const value = useMemo(() => ({ ...link, topics }), [link, topics]);
  return <EngineContext value={value}>{props.children}</EngineContext>;
}

/** The signed-in client; only screens inside {@link EngineProvider} call it. */
export function useEngine(): SignedInEngine {
  const link = useContext(EngineContext);
  if (link === undefined) {
    throw new Error("A console screen ran outside the signed-in console.");
  }
  return link;
}
