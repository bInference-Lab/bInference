import type { Http } from "@binference/core";
import type { RiskSourceUse } from "@binference/engine/risk";
import { createGoplusSource } from "@binference/goplus";
import { createHoneypotSource } from "@binference/honeypot-is";

/**
 * The risk sources of a self-hosted engine, both keyless, over its outbound HTTP. A token the
 * registry does not list needs GoPlus's report (ARCHITECTURE.md section 7: "a clean GoPlus
 * answer"); honeypot.is is a second opinion whose findings count when it answers and whose
 * outage blocks nothing.
 */
export function selfHostedRiskSources(http: Http): readonly RiskSourceUse[] {
  return [
    { source: createGoplusSource({ http }), isRequired: true },
    { source: createHoneypotSource({ http }), isRequired: false },
  ];
}
