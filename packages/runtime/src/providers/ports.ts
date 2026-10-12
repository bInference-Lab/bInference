import type { HttpRequest } from "@binference/core";
import type { StreamedHttpResponse } from "./streamed-http-response.js";

// What the model transports reach the network through. The runtime's composition root binds it
// to the process's own outbound HTTP; tests bind it to recorded answers.

/**
 * Sends one HTTP request and answers as soon as the status and headers arrive, the body still
 * streaming, as a model provider's server-sent events do. A status of 400 or more is an answer,
 * not a fault. A request that never gets an answer rejects with a `BinferenceError`; an aborted
 * signal rejects with its reason, and ends a body that is still streaming.
 */
export interface StreamingHttp {
  open(request: HttpRequest): Promise<StreamedHttpResponse>;
}
