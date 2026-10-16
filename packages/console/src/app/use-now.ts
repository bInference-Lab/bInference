import { useEffect, useState } from "react";

// Counters of whole seconds redraw a little more often, so they never skip one.
const tickMs = 250;

/** The browser's time now, read again every quarter second while the component is mounted. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, []);
  return now;
}
