// The row-level-security shape an application may put on the platform's
// tables, `app_rls_bypass() OR "tenantId" = app_current_tenant()`, as the
// tests ask it.
//
// An application opens its tenant frame in an interceptor, after every guard,
// so a check that runs in a guard asks before that frame is open. A store
// built on `visibleTo` answers as such a policy does: a tenant's rows inside
// that tenant's frame, every row inside the bypass, and nothing outside both.
// The frame is kept the way the shipped adapters keep it, in
// AsyncLocalStorage, so two reads running at once never borrow each other's.

import { AsyncLocalStorage } from 'node:async_hooks';

/** The frame the installation keeps for a statement: a tenant's, the bypass, or none. */
export const frame = new AsyncLocalStorage();

/** Whether the policy shows a row of `tenantId` to a statement sent from here. */
export const visibleTo = (tenantId) =>
    frame.getStore()?.acrossTenants === true || frame.getStore()?.tenantId === tenantId;

/** The installation's bypass, carrying over what the frame held, as the port asks. */
export const BYPASS = {
    runWithBypass: (work) => frame.run({ ...frame.getStore(), acrossTenants: true }, work),
};

/** The frames a check is asked in, each running `work` for the request of `tenantId`. */
export const FRAMES = {
    // The application's guard and the platform's: no frame is open yet.
    'before the tenant frame': (_tenantId, work) => frame.run(undefined, work),
    // A handler, once the application's interceptor opened the frame.
    "in the tenant's frame": (tenantId, work) =>
        frame.run({ tenantId, acrossTenants: false }, work),
    // An operator's route, behind the administrator's interceptor.
    "in an operator's bypass": (_tenantId, work) =>
        frame.run({ tenantId: null, acrossTenants: true }, work),
};

/** The same expectation for every frame, keyed as `outcomes` keys what it found. */
export const inEveryFrame = (expected) =>
    Object.fromEntries(Object.keys(FRAMES).map((name) => [name, expected]));

/** What a refusal says, by its code; anything without one is thrown on. */
export function codeOf(error) {
    const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    if (typeof response?.code === 'string') return response.code;
    if (typeof error?.code === 'string') return error.code;
    throw error;
}

/**
 * What `check` answers for each of `tenants` — a tenant id by what it stands
 * for — in each frame: what it resolves to, or the refusal's code. `passed`
 * stands for a check that resolves to nothing.
 */
export async function outcomes(tenants, check) {
    const found = {};
    for (const [name, within] of Object.entries(FRAMES)) {
        found[name] = {};
        for (const [what, tenantId] of Object.entries(tenants)) {
            found[name][what] = await within(tenantId, async () => check(tenantId)).then(
                (answer) => answer ?? 'passed',
                codeOf,
            );
        }
    }
    return found;
}
