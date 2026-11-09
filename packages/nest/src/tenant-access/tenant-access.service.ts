// TenantAccessService — what a tenant's users may do, asked on every request
// (`SC-ADM-052`).
//
// The application calls `enforce` at the end of its own authentication guard,
// once the tenant of the request is known, and `assertAllowed` where there is
// no request to read a method from: a sign-in, a scheduled job. The platform
// does the same behind the application's guards on its own tenant routes. A
// session opened before the state changed is held to it on its next request,
// since nothing is cached between two.

import { type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    KINDS_HOLDING_EVERYONE_BACK,
    TENANT_ACCESS_ERROR_CODES,
    type TenantAccess,
    type TenantAccessErrorCode,
    type TenantAccessHold,
    type TenantAccessActor,
    type TenantAccessHoldPort,
    type TenantAccessState,
    requestWrites,
    tenantAccessOf,
    tenantAccessRefusal,
} from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';
import { tenantAccessMarkOf } from './tenant-access-marks.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from './tenant-access.tokens.js';

const REFUSAL_CODE: Readonly<Record<Exclude<TenantAccessState, 'open'>, TenantAccessErrorCode>> = {
    'read-only': TENANT_ACCESS_ERROR_CODES.TENANT_READ_ONLY,
    suspended: TENANT_ACCESS_ERROR_CODES.TENANT_SUSPENDED,
    deleting: TENANT_ACCESS_ERROR_CODES.TENANT_BEING_DELETED,
};

/** What a request asks to do, where there is no request to read it from. */
export interface TenantAccessIntent extends TenantAccessActor {
    writes: boolean;
    /**
     * It starts a payment — pays now, or replaces the payment method: the one
     * kind of write a read-only tenant may make, while one of its subscriber's
     * invoices is open (`SC-ADM-052`).
     */
    startsPayment?: boolean;
}

/**
 * Whether a tenant's subscriber has an invoice open, as the tenant's own list
 * of invoices shows it. Answered by the invoices where they are wired.
 */
export interface OpenInvoiceSource {
    hasOpenInvoice(tenantId: string): Promise<boolean>;
}

/** An invoice a reason names, by what tells it apart and whose record lists it. */
export interface NamedInvoice {
    id: string;
    number: string;
    subscriberId: string;
}

/** What the invoices a reason names are called. Answered by the invoices where they are wired. */
export interface InvoiceNameSource {
    invoicesNamed(invoiceIds: readonly string[]): Promise<NamedInvoice[]>;
}

interface RequestLike {
    method?: string;
}

/** The tenant a request was checked for, once it passed. */
interface PassedCheck {
    tenantId: string;
}

@Injectable()
export class TenantAccessService {
    /**
     * The requests that passed a check, by request object, kept on the server
     * and gone with the request. Only the application can say that a request
     * is the operator acting as the tenant, and it says so to `enforce`; the
     * platform's own check on the same request then trusts what passed rather
     * than asking again without knowing who is asking.
     */
    private readonly passed = new WeakMap<object, PassedCheck>();

    /**
     * Where an open invoice is looked up. Registered by the invoices rather
     * than injected, since they are composed inside tenant billing and this
     * service is global; without invoices no invoice can be open, and a
     * read-only tenant starts no payment.
     */
    private openInvoices: OpenInvoiceSource | null = null;

    /** Where an invoice a reason names is looked up by its id, registered as `openInvoices` is. */
    private invoiceNames: InvoiceNameSource | null = null;

    constructor(
        @Inject(TENANT_ACCESS_HOLDS_TOKEN) private readonly holds: TenantAccessHoldPort,
        @Inject(Reflector) private readonly reflector: Reflector,
    ) {}

    /** Lets `source` say whether a tenant's subscriber has an invoice open. */
    answerOpenInvoicesFrom(source: OpenInvoiceSource): void {
        this.openInvoices = source;
    }

    /** Lets `source` say what the invoices a reason names are called. */
    nameInvoicesFrom(source: InvoiceNameSource): void {
        this.invoiceNames = source;
    }

    /**
     * The invoices among `invoiceIds` that can be read, by number and the
     * subscriber whose record lists them; none where invoices are not wired.
     */
    async invoicesNamed(invoiceIds: readonly string[]): Promise<NamedInvoice[]> {
        if (invoiceIds.length === 0 || !this.invoiceNames) return [];
        return this.invoiceNames.invoicesNamed(invoiceIds);
    }

    /** The state of `tenantId` and the open reasons it follows from. */
    async accessOf(tenantId: string): Promise<TenantAccess> {
        return tenantAccessOf(await this.holds.listOpen(tenantId));
    }

    /** Every tenant nobody of which acts at all: suspended, or being deleted. */
    async tenantsHeldBack(): Promise<string[]> {
        return this.holds.listTenantIdsHeldBy(KINDS_HOLDING_EVERYONE_BACK);
    }

    /** The state of each of `tenantIds`, from one read; a tenant without an open reason is open. */
    async accessOfEach(tenantIds: readonly string[]): Promise<Map<string, TenantAccess>> {
        const holds = await this.holds.listOpenFor(tenantIds);
        return new Map(
            tenantIds.map((tenantId) => [
                tenantId,
                tenantAccessOf(holds.filter((hold) => hold.tenantId === tenantId)),
            ]),
        );
    }

    /**
     * Records the operator's suspension of `tenantId` with their `note`, or
     * null where the tenant is suspended already: the suspension that stands
     * keeps its own note and moment.
     */
    async suspend(
        tenantId: string,
        note: string,
        recordedBy: string,
        at: Date,
    ): Promise<TenantAccessHold | null> {
        return this.holds.record({
            tenantId,
            kind: 'suspended',
            reference: null,
            note,
            since: at,
            recordedBy,
        });
    }

    /**
     * Lifts the suspension of `tenantId` and no other reason, or answers null
     * where the tenant is not suspended. An overdue invoice or an ended
     * subscription keeps the tenant where that reason puts it.
     */
    async reactivate(
        tenantId: string,
        liftedBy: string,
        at: Date,
    ): Promise<TenantAccessHold | null> {
        const open = await this.holds.listOpen(tenantId);
        const suspension = open.find((hold) => hold.kind === 'suspended');
        return suspension ? this.holds.lift(suspension.id, at, liftedBy) : null;
    }

    /**
     * Refuses the current request where `tenantId`'s state does not allow it.
     * Whether it writes is its route's mark, or else its method; a request
     * whose method cannot be read counts as a write.
     */
    async enforce(
        context: ExecutionContext,
        tenantId: string,
        actor: TenantAccessActor = {},
    ): Promise<void> {
        const request = context.switchToHttp().getRequest<RequestLike>();
        const mark = tenantAccessMarkOf(this.reflector, context);
        const writes =
            typeof request.method === 'string'
                ? requestWrites(request.method, mark)
                : mark !== 'writes-nothing';
        await this.assertAllowed(tenantId, {
            ...actor,
            writes,
            startsPayment: mark === 'starts-payment',
        });
        if (typeof request === 'object' && request !== null) this.passed.set(request, { tenantId });
    }

    /**
     * Refuses the current request as `enforce` does, unless the application
     * already checked it for `tenantId` and it passed — with the operator
     * acting as the tenant, where the application said so. A request the
     * application did not check, or checked for another tenant, is checked here
     * as a tenant user's. The platform's tenant routes ask this.
     */
    async enforceUnlessChecked(context: ExecutionContext, tenantId: string): Promise<void> {
        const request = context.switchToHttp().getRequest<RequestLike>();
        const checked =
            typeof request === 'object' && request !== null ? this.passed.get(request) : undefined;
        if (checked?.tenantId === tenantId) return;
        await this.enforce(context, tenantId);
    }

    /** Refuses what `intent` describes where `tenantId`'s state does not allow it. */
    async assertAllowed(tenantId: string, intent: TenantAccessIntent): Promise<void> {
        const access = await this.accessOf(tenantId);
        const refusal = tenantAccessRefusal(access, intent.writes, intent);
        if (!refusal) return;
        // Asked only where it decides: a read-only tenant starting a
        // payment. A suspension or a deletion under way has no such
        // exception, and whether the user may pay at all is the billing
        // permission's.
        if (
            refusal === 'read-only' &&
            intent.startsPayment === true &&
            (await this.openInvoices?.hasOpenInvoice(tenantId)) === true
        ) {
            return;
        }
        // The operator's note on a suspension is theirs, not the tenant's: a
        // refusal names each reason by its kind and the moment it began.
        throw new ForbiddenException(
            codedError(REFUSAL_CODE[refusal], {
                reasons: access.holds.map((hold) => ({
                    kind: hold.kind,
                    since: hold.since.toISOString(),
                })),
            }),
        );
    }
}
