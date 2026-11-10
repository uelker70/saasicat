// How a route says what it does where its method would say otherwise.
//
// A read-only tenant reads, and a request reads when its method does: `GET`,
// `HEAD` and `OPTIONS`. A route that writes nothing under another method — a
// preview, a PDF rendered from data already there, an export's test run —
// carries `@WritesNothing()`; a `GET` that writes carries `@Writes()`. A route
// that answers the tenant's own state carries `@ReadsItsState()`, and every
// state lets it through. A mark rather than a list of paths, for the reason
// `@AllowDuringMaintenance()` gives: the platform does not know where an
// application mounts its routes.

import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { TenantAccessMark } from '@saasicat/core';

/** Metadata key of the mark. `Symbol.for` keeps it stable across package entries. */
export const TENANT_ACCESS_MARK_KEY = Symbol.for('saasicat/nest/tenant-access-mark');

/**
 * Lets a read-only tenant through a route whose method writes: it writes
 * nothing. Marking a route that does write lets a held-back tenant change data
 * it is not meant to change.
 */
export const WritesNothing = (): ClassDecorator & MethodDecorator =>
    SetMetadata(TENANT_ACCESS_MARK_KEY, 'writes-nothing' satisfies TenantAccessMark);

/** Holds a read-only tenant back from a route whose method reads: it writes. */
export const Writes = (): ClassDecorator & MethodDecorator =>
    SetMetadata(TENANT_ACCESS_MARK_KEY, 'writes' satisfies TenantAccessMark);

/**
 * The one kind of write read-only lets through: starting a payment — paying
 * now, or replacing the payment method —, while one of the subscriber's
 * invoices is open (`SC-ADM-052`). The platform's own routes carry it, and
 * nothing else should — whether the user may pay at all is still the billing
 * permission's to say.
 */
export const StartsPayment = (): MethodDecorator =>
    SetMetadata(TENANT_ACCESS_MARK_KEY, 'starts-payment' satisfies TenantAccessMark);

/**
 * Lets every user of a tenant through to a route that answers the tenant's own
 * state, in every state — suspended and being deleted included —, since it is
 * what tells them why they cannot act (`SC-ADM-054`). It skips the access
 * check altogether, so it belongs only on a route that reads the state and
 * nothing else of the tenant's; the platform's own routes carry it.
 */
export const ReadsItsState = (): MethodDecorator =>
    SetMetadata(TENANT_ACCESS_MARK_KEY, 'reads-its-state' satisfies TenantAccessMark);

/** The mark on the current endpoint, the handler's before its class's, or null. */
export function tenantAccessMarkOf(
    reflector: Reflector,
    context: ExecutionContext,
): TenantAccessMark | null {
    return (
        reflector.getAllAndOverride<TenantAccessMark | undefined>(TENANT_ACCESS_MARK_KEY, [
            context.getHandler(),
            context.getClass(),
        ]) ?? null
    );
}
