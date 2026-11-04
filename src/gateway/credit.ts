import { MetaError, type MetaClient } from "./meta-client.ts";

export class CreditExhausted extends Error {}

/**
 * The Meta account has run out of credit: retrying cannot help, and the review screen says so in plain words.
 * Assumed: Meta does not document this error; 402 or a credit/quota/billing message is a guess until it happens.
 */
export const creditGuard = (client: MetaClient): MetaClient => async (req, signal) => {
  try {
    return await client(req, signal);
  } catch (e) {
    if (e instanceof MetaError && (e.status === 402 || /credit|quota|billing/i.test(e.message))) throw new CreditExhausted(e.message);
    throw e;
  }
};
