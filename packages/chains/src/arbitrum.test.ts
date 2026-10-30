import { arbitrum } from "./arbitrum.js";
import { checkEvmDestination } from "./checks/evm-destination-checks.js";

checkEvmDestination(arbitrum, "42161");
