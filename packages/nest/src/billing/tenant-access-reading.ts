// What a user of the tenant is told of its state (`SC-ADM-054`), shared by the
// route every user reads and the one behind the billing permission, so the two
// answer a holder of the permission alike.

import {
    installationZoneOf,
    tenantAccessViewOf,
    type PlanCatalogSettings,
    type TenantAccessView,
} from '@saasicat/core';

import type { TenantAccessService } from '../tenant-access/tenant-access.service.js';
import { mayTakeTheTenantsExport } from './tenant-roles.js';

/** Who reads the state, and what the installation lets them do about it. */
export interface TenantAccessReading {
    /** Without it — a module wired by hand without `SaaSiCatModule` — nothing records a reason, so the tenant is open. */
    access: TenantAccessService | null;
    settings: Pick<PlanCatalogSettings, 'timeZone'> | null;
    tenantId: string;
    request: unknown;
    /** Whether the reader holds the billing permission, where the installation issues invoices. */
    holdsBillingPermission: boolean;
    /** Whether the installation collects through a payment gateway. */
    collects: boolean;
}

/** The tenant's state as `reading` says who is asking. */
export async function tenantAccessViewFor(reading: TenantAccessReading): Promise<TenantAccessView> {
    const { access, request } = reading;
    const asked = {
        timeZone: installationZoneOf(reading.settings),
        now: new Date(),
        holdsBillingPermission: reading.holdsBillingPermission,
        mayPay: reading.collects,
        isTenantAdministrator: mayTakeTheTenantsExport(
            request,
            access?.actsAsOperator(request) ?? false,
        ),
    };
    if (!access) return tenantAccessViewOf({ state: 'open', holds: [] }, asked);
    return access.viewOf(reading.tenantId, asked);
}
