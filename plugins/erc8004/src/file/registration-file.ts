import type { RegistrationCard } from "@binference/plugin-sdk";

// ERC-8004's type of a registration file, from the ERC's text.
const registrationType = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

// Where binference is published, which its service entry names.
const binferenceEndpoint = "https://www.npmjs.com/package/binference";

const dataUriPrefix = "data:application/json;base64,";

/**
 * The registration file of the card, as decision 0334 writes it: ERC-8004's `registration-v1`
 * JSON, compact, its keys in the ERC's order, as a base64 `data:` URI, the form the ERC asks of a
 * file stored on chain. Its one `wallet` service names the registering wallet as a CAIP-10
 * account, and its `binference` service the release version; there is no picture, no
 * registration (the mint gives the id after the file is written) and no trust model.
 */
export function registrationFileOf(card: RegistrationCard): string {
  const file = {
    type: registrationType,
    name: card.name,
    description: card.description,
    image: "",
    services: [
      { name: "wallet", endpoint: card.wallet },
      { name: "binference", endpoint: binferenceEndpoint, version: card.version },
    ],
    x402Support: false,
    active: true,
    registrations: [],
    supportedTrust: [],
  };
  return `${dataUriPrefix}${Buffer.from(JSON.stringify(file), "utf8").toString("base64")}`;
}
