import type { ProtocolClient } from "@binference/client";
import type { ReadyFrame } from "@binference/protocol";
import { createContext, type ReactNode, useContext } from "react";

/** The signed-in client and the engine's `ready`, for every screen of the console. */
export interface EngineLink {
  readonly client: ProtocolClient;
  readonly ready: ReadyFrame;
}

const EngineContext = createContext<EngineLink | undefined>(undefined);

/** Gives the screens below it the signed-in client. */
export function EngineProvider(props: {
  readonly link: EngineLink;
  readonly children: ReactNode;
}): React.JSX.Element {
  return <EngineContext value={props.link}>{props.children}</EngineContext>;
}

/** The signed-in client; only screens inside {@link EngineProvider} call it. */
export function useEngine(): EngineLink {
  const link = useContext(EngineContext);
  if (link === undefined) {
    throw new Error("A console screen ran outside the signed-in console.");
  }
  return link;
}
