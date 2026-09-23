// What a tenant's billing area reads a refusal as.
//
// Its routes sit behind the billing permission, and an installation that takes
// no payment methods does not mount them. A 403 and a 404 are therefore answers
// about what this user may see here, not failures: the part of the page asking
// hides itself. Anything else is an error that part has to say.

/** The statuses that say a part of the billing area is not for this user. */
const HIDDEN_FROM_THIS_USER: ReadonlySet<number> = new Set([403, 404, 501]);

/** Whether a failed request's status says the part is not for this user, rather than failed. */
export function isHiddenFromThisUser(status: number | undefined): boolean {
    return status !== undefined && HIDDEN_FROM_THIS_USER.has(status);
}
