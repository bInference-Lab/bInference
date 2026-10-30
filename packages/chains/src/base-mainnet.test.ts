import { baseMainnet } from "./base-mainnet.js";
import { checkEvmDestination } from "./checks/evm-destination-checks.js";

checkEvmDestination(baseMainnet, "8453");
