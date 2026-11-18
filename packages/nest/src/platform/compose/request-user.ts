// Who is behind a request: the resolvers an application binds at the root of
// the options, provided by the platform module, which is global — so the second
// factor, every operator route that records who acted and every tenant route
// read the same ones (`core/request-user.ts`, `SC-AUD-022`).

import type { Provider } from '@nestjs/common';

import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
} from '../../billing/tenant-billing.tokens.js';
import type { SaaSiCatModuleOptions } from '../module-options.js';

const RESOLVERS = [
    ['userIdResolver', USER_ID_RESOLVER_TOKEN],
    ['userEmailResolver', USER_EMAIL_RESOLVER_TOKEN],
    ['auditContextResolver', AUDIT_CONTEXT_RESOLVER_TOKEN],
] as const;

/** A provider for each resolver the application bound. */
export function composeRequestUser(options: SaaSiCatModuleOptions): Provider[] {
    assertNoResolverUnderTenantBilling(options.tenantBilling);
    return RESOLVERS.flatMap(([option, token]) => {
        const resolver = options[option];
        return resolver ? [{ provide: token, useValue: resolver }] : [];
    });
}

/**
 * Refuses the boot where a resolver is still named under `tenantBilling`.
 * Ignored silently, the application's rule would be dropped, and a route would
 * name a different user than the application means — or nobody, where its
 * authentication sets `userId`.
 */
function assertNoResolverUnderTenantBilling(tenantBilling: unknown): void {
    if (typeof tenantBilling !== 'object' || tenantBilling === null) return;
    const moved = RESOLVERS.map(([option]) => option).filter((option) => option in tenantBilling);
    if (moved.length === 0) return;
    throw new Error(
        moved
            .map(
                (option) =>
                    `\`tenantBilling.${option}\` moved to the root of the options: ` +
                    `\`SaaSiCatModule.forRoot({ ${option} })\`.`,
            )
            .join(' ') +
            ' Every route reads the user behind a request from there — the operator routes ' +
            'and the second factor as well as the tenant routes. Move it there and delete it ' +
            'here. See docs/guides/upgrade-to-1.0.md.',
    );
}
