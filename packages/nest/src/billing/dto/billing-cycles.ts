import type { BillingCycle } from '@saasicat/core';

/**
 * The rhythms a plan is sold and billed in. A request naming another is
 * refused at the boundary: the preview would price it as monthly, and the
 * change would store it beside a contract frozen in the rhythm it was priced in.
 */
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const satisfies readonly BillingCycle[];
