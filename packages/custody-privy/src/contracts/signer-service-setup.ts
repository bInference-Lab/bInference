import { createSecret } from "@binference/core";
import { type ClientCertHttp, createClientCertHttp } from "@binference/platform/client-cert-http";
import { makeTestCertificate, type TestCertificate } from "@binference/platform/testing";
import { signerServiceAnswerBytes } from "../signing/service-answer.js";

/**
 * The certificates of a signer service test: one authority signs the service's certificate for
 * 127.0.0.1 and a worker's, and a stranger signs its own, naming the same worker.
 */
export interface ServiceCertificates {
  readonly authority: TestCertificate;
  readonly service: TestCertificate;
  readonly worker: TestCertificate;
  readonly stranger: TestCertificate;
}

/** The URI name of the tests' worker, `w-1`. */
const workerUri = "spiffe://binference.io/worker/w-1";

/** Makes the certificates, valid from an hour before `nowMs`, the time TLS checks them by. */
export function makeServiceCertificates(nowMs: number): ServiceCertificates {
  const authority = makeTestCertificate({ name: "signer authority", nowMs, isAuthority: true });
  return {
    authority,
    service: makeTestCertificate({
      name: "signer service",
      nowMs,
      ipAddresses: ["127.0.0.1"],
      issuer: authority,
    }),
    worker: makeTestCertificate({ name: "worker", nowMs, uris: [workerUri], issuer: authority }),
    stranger: makeTestCertificate({
      name: "stranger",
      nowMs,
      isAuthority: true,
      uris: [workerUri],
    }),
  };
}

/**
 * The `Http` a worker reaches the service with: it presents the client's certificate and trusts
 * only the certificates' authority, reading answers of up to `signerServiceAnswerBytes`.
 */
export function serviceHttpOf(
  certificates: ServiceCertificates,
  client: TestCertificate,
): ClientCertHttp {
  return createClientCertHttp({
    certificate: {
      cert: client.cert,
      key: createSecret(client.key),
      ca: certificates.authority.cert,
    },
    userAgent: "binference/test",
    maxAnswerBytes: signerServiceAnswerBytes,
  });
}
