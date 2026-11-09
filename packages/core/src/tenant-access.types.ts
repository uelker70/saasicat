// What a tenant's users may do, and why (`SC-ADM-024`).
//
// A tenant is held back for reasons, and every reason that holds is recorded on
// its own: an operator's suspension, an invoice unpaid on its due date, a
// subscription that ended, a deletion under way. The state is the
// strictest of the open reasons, so ending one reason lifts only that one — a
// tenant that pays its overdue invoice while the operator has it suspended
// stays suspended.
//
// Reading is what a read-only tenant keeps, and a request reads when its method
// does: `GET`, `HEAD` and `OPTIONS` read, every other method writes. A route
// that writes nothing under another method says so with a mark, and a `GET`
// that writes says that; the mark wins over the method. A forgotten mark
// therefore refuses a harmless request rather than letting a write through,
// except for a `GET` that writes, which REST makes rare.
//
// Read-only stops at one write: replacing the payment method while one of the
// subscriber's invoices is open, because the claim outlives the subscription
// and nobody else can enter a means of payment for it. The route that does it
// says so with a mark of its own, and is still a write everywhere else.

/** Why a tenant is held back. */
export type TenantAccessHoldKind = 'suspended' | 'overdue' | 'ended' | 'deleting';

/** What a tenant's users may do: everything, read, nothing, or nothing ever again. */
export type TenantAccessState = 'open' | 'read-only' | 'suspended' | 'deleting';

/** One reason, as a store reads it back. Open while `liftedAt` is null. */
export interface TenantAccessHold {
    id: string;
    tenantId: string;
    kind: TenantAccessHoldKind;
    /**
     * What the reason is about, where it is about one thing: the overdue
     * invoice, the subscription that ended. Null for a suspension, which is
     * about the tenant.
     */
    reference: string | null;
    /** The operator's words for a suspension; null where the reason speaks for itself. */
    note: string | null;
    /** When the reason began to hold. */
    since: Date;
    /** Who recorded it, as the audit log tags an actor, or the run that did. */
    recordedBy: string;
    liftedAt: Date | null;
    liftedBy: string | null;
}

/** A reason to record: it holds, so it has not been lifted. */
export type NewTenantAccessHold = Omit<TenantAccessHold, 'id' | 'liftedAt' | 'liftedBy'>;

/** The state a tenant is in, and the open reasons it follows from. */
export interface TenantAccess {
    state: TenantAccessState;
    holds: readonly TenantAccessHold[];
}

/**
 * What each reason restricts, strictest last. A deletion under way stops even
 * the operator acting as the tenant (`SC-PRIV-018`); a suspension stops every
 * user; an overdue invoice or an ended subscription leaves reading.
 */
const STATE_OF_KIND: Readonly<Record<TenantAccessHoldKind, TenantAccessState>> = {
    overdue: 'read-only',
    ended: 'read-only',
    suspended: 'suspended',
    deleting: 'deleting',
};

const STRICTNESS: readonly TenantAccessState[] = ['open', 'read-only', 'suspended', 'deleting'];

/** The kinds of reason that stop every user of a tenant, reading included. */
export const KINDS_HOLDING_EVERYONE_BACK: readonly TenantAccessHoldKind[] = [
    'suspended',
    'deleting',
];

/** Whether nobody of a tenant in `state` acts at all. */
export function holdsEveryoneBack(state: TenantAccessState): boolean {
    return state === 'suspended' || state === 'deleting';
}

/** The strictest state the open reasons among `holds` put a tenant in. */
export function tenantAccessOf(holds: readonly TenantAccessHold[]): TenantAccess {
    const open = holds.filter((hold) => hold.liftedAt === null);
    const state = open.reduce<TenantAccessState>((strictest, hold) => {
        const state = STATE_OF_KIND[hold.kind];
        return STRICTNESS.indexOf(state) > STRICTNESS.indexOf(strictest) ? state : strictest;
    }, 'open');
    return { state, holds: open };
}

/**
 * How a route declares what it does, where its method would say otherwise:
 * it writes nothing, it writes, or it replaces the payment method — a write
 * that read-only lets through while an invoice is open.
 */
export type TenantAccessMark = 'writes-nothing' | 'writes' | 'replaces-payment-method';

const READING_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Whether a request writes: its route's mark where it has one, otherwise its method. */
export function requestWrites(method: string, mark: TenantAccessMark | null): boolean {
    if (mark === 'writes-nothing') return false;
    if (mark === 'writes' || mark === 'replaces-payment-method') return true;
    return !READING_METHODS.has(method.toUpperCase());
}

/** Who is asking, where it changes the answer. */
export interface TenantAccessActor {
    /**
     * The operator acting as the tenant (`SC-ADM-005`). Not one of its users,
     * so held back only once the tenant is being deleted.
     */
    actingAsOperator?: boolean;
}

/**
 * Whether a request may go ahead, and the state that refuses it where it may
 * not. Pure: the state comes in, nothing is read.
 */
export function tenantAccessRefusal(
    access: TenantAccess,
    writes: boolean,
    actor: TenantAccessActor = {},
): Exclude<TenantAccessState, 'open'> | null {
    if (access.state === 'deleting') return 'deleting';
    if (actor.actingAsOperator) return null;
    if (access.state === 'suspended') return 'suspended';
    if (access.state === 'read-only' && writes) return 'read-only';
    return null;
}
