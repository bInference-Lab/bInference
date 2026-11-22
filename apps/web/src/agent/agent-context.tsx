"use client";

import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from "react";
import { type AgentBus, createAgentBus } from "./agent-bus";

// A page without a provider still gets an agent of its own, asleep.
const AgentContext = createContext<AgentBus>(createAgentBus());

/** Gives every section on the page the same agent. */
export function AgentProvider(props: { readonly children: ReactNode }): React.JSX.Element {
  const [bus] = useState(createAgentBus);
  return <AgentContext value={bus}>{props.children}</AgentContext>;
}

/** The page's agent. */
export function useAgent(): AgentBus {
  return useContext(AgentContext);
}

/** How many times the reader has tapped, for the counter in the navigation. */
export function useTaps(): number {
  const bus = useAgent();
  return useSyncExternalStore(bus.subscribe, bus.taps, () => 0);
}
