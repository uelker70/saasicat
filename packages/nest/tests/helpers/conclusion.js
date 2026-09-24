// The stores a checkout offer's conclusion writes through, in memory: its
// contract and the subscriber the contract names. Each records the transaction
// a row was written on, and can be put back the way a rollback would.

/** Contracts in memory, recording the transaction each write ran on. */
export function fakeContractRepo() {
    const rows = [];
    return {
        rows,
        async create(data, tx) {
            const row = { ...structuredClone(data), id: `contract-${rows.length + 1}`, tx };
            rows.push(row);
            return row;
        },
        async findByOriginalOfferId(offerId) {
            return rows.find((row) => row.originalOfferId === offerId) ?? null;
        },
        snapshot: () => [...rows],
        restore: (saved) => rows.splice(0, rows.length, ...saved),
    };
}

/**
 * Subscribers in memory, one live per tenant, recording the transaction each
 * was created on. `tenants` already have one.
 */
export function fakeSubscriberRepo(tenants = []) {
    const rows = tenants.map((tenantId, index) => subscriberRow(tenantId, index, undefined));
    return {
        rows,
        async createForTenant(data, tx) {
            if (rows.some((row) => row.tenantId === data.tenantId)) return null;
            const { customerNumberPrefix, ...details } = data;
            const row = { ...subscriberRow(data.tenantId, rows.length, tx), ...details };
            row.customerNumber = `${customerNumberPrefix}${10001 + rows.length}`;
            rows.push(row);
            return row;
        },
        async findByTenantId(tenantId) {
            return rows.find((row) => row.tenantId === tenantId) ?? null;
        },
        snapshot: () => [...rows],
        restore: (saved) => rows.splice(0, rows.length, ...saved),
    };
}

function subscriberRow(tenantId, index, tx) {
    return {
        id: `subscriber-${index + 1}`,
        customerNumber: `${10001 + index}`,
        tenantId,
        legalName: `Customer of ${tenantId}`,
        vatId: null,
        taxNumber: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        country: null,
        invoiceEmail: null,
        migrated: false,
        tx,
    };
}
