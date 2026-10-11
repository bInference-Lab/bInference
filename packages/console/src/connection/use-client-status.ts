import type { ClientStatus, ProtocolClient } from "@binference/client";
import { useEffect, useState } from "react";

// The client says where it stands only when asked; twice a second is enough for a status line.
const checkEveryMs = 500;

/** Where the client stands now: ready, reconnecting or closed. */
export function useClientStatus(client: ProtocolClient): ClientStatus["state"] {
  const [state, setState] = useState(client.status().state);
  useEffect(() => {
    const timer = setInterval(() => setState(client.status().state), checkEveryMs);
    return () => clearInterval(timer);
  }, [client]);
  return state;
}
