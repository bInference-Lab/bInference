import { connect } from "node:net";
import { networkInterfaces } from "node:os";

// A connection on the machine's own address answers or is refused in moments; one that waits
// longer is dropped by a firewall, so nothing answers there.
const connectMs = 1_000;

/** This machine's addresses beyond loopback, IPv6 link-local ones left out. */
function machineAddresses(): readonly string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal && !entry.address.startsWith("fe80:"))
    .map((entry) => entry.address);
}

async function answers(host: string, port: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: connectMs, signal });
    const end = (outcome: "answered" | "silent") => {
      socket.destroy();
      resolve(outcome === "answered");
    };
    socket.once("connect", () => end("answered"));
    socket.once("timeout", () => end("silent"));
    socket.once("error", () => end("silent"));
  });
}

/**
 * Whether anything answers a TCP connection at `port` on one of `addresses`, this machine's
 * addresses beyond loopback unless a test names others: the engine binds only `127.0.0.1`, so an
 * answer there means something forwards its port (decision 0341). All are tried at once, each
 * for at most a second.
 */
export async function answersBeyondLoopback(
  port: number,
  signal: AbortSignal,
  addresses: readonly string[] = machineAddresses(),
): Promise<boolean> {
  const answered = await Promise.all(addresses.map(async (host) => answers(host, port, signal)));
  return answered.includes(true);
}
