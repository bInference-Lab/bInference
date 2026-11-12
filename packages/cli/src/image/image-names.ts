/** The names the edge answers to on the smoke test's network: the services init and start call. */
export const edgeHosts: readonly string[] = ["api.privy.io", "api.telegram.org", "api.openai.com"];

/** Where the edge writes its certificate, a volume the container under test mounts read-only. */
export const edgeCertFolder = "/edge";

/**
 * The port of the scripted model on the engine container's loopback, which the agent runtime
 * reaches over plain HTTP: it trusts no certificate of the test's.
 */
export const modelPort = 18_080;
