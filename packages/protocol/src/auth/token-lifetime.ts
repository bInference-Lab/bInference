/**
 * The longest a client token may live: `token/register` refuses an `expiresAt` more than 90 days
 * after the engine's time (decision 0159).
 */
export const tokenLifetimeMaxMs: number = 90 * 24 * 60 * 60 * 1000;
