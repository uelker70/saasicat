// The platform as an application composes it, every adapter a fake, with a
// handful of subscribers — what the operator's subscriber routes are asked
// through. It records where each read ran (inside the bypass frame or in the
// request's own), what the audit log was given, and what the VAT number service
// was asked, so a test asserts what a route did rather than what it returned.

import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { AdminManifestService, SaaSiCatModule } from '../../dist/platform/index.js';
import { FakeSubscriberRepository } from '../../dist/testing/index.js';
import { storeSecretsInPlainText } from '../../dist/index.js';
import { controllersIn, handlersOf } from './operator-routes.js';
import { TAX_SETTINGS, TEST_TAX_ADAPTER } from './tax-adapter.js';

export const SUBSCRIBER_ROUTE = 'GET admin/tenants/:slug/subscriber';
export const ATTENTION_ROUTE = 'GET admin/subscribers/attention';

const ADDRESS = { addressLine1: 'Hafenstraße 1', postalCode: '20457', city: 'Hamburg' };

/** The subscribers of the installation, by the tenant each belongs to. */
const SUBSCRIBERS = {
    't-northwind': { legalName: 'Northwind GmbH', ...ADDRESS, country: 'DE', business: true },
    't-fabrikam': { legalName: 'Fabrikam GmbH', ...ADDRESS, country: 'DE', city: null },
    't-contoso': { legalName: 'Contoso SARL', ...ADDRESS, country: 'FR', business: false },
    't-wien': {
        legalName: 'Wien GmbH',
        ...ADDRESS,
        country: 'AT',
        business: true,
        vatId: 'ATU12345678',
    },
};
export const TENANTS = ['northwind', 'fabrikam', 'contoso', 'wien', 'empty'];

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Probe' },
    plans: [],
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
};

/** The details a subscriber is created with: everything an invoice names unless `details` empties it. */
const detailsOf = (details) => ({
    addressLine2: null,
    vatId: null,
    taxNumber: null,
    invoiceEmail: null,
    business: null,
    customerNumberPrefix: 'K-',
    ...details,
});

/** A valid answer of the VAT number service, dated when it is given. */
export const validAnswer = (vatId) => ({
    completed: true,
    check: {
        vatId,
        checkedAt: new Date(),
        valid: true,
        service: 'VIES',
        confirmation: { requestIdentifier: 'R-1' },
    },
});

/**
 * The platform with the subscribers above. `checkVatId` is what the VAT number
 * service answers where the adapter is bound; Wien's number holds a valid check
 * from before.
 */
export async function aPlatform({
    adapter = true,
    adminResources = true,
    subscribers = true,
    checkVatId = validAnswer,
} = {}) {
    const seen = { lookups: [], reads: [], audited: [], checked: [] };
    let bypassed = 0;
    const rlsBypass = {
        async runWithBypass(fn) {
            bypassed += 1;
            try {
                return await fn();
            } finally {
                bypassed -= 1;
            }
        },
    };
    const repo = new FakeSubscriberRepository();
    for (const [tenantId, details] of Object.entries(SUBSCRIBERS)) {
        await repo.createForTenant({ tenantId, ...detailsOf(details) });
    }
    const wien = await repo.findByTenantId('t-wien');
    await repo.recordVatIdCheck(wien.id, {
        vatId: 'ATU12345678',
        checkedAt: new Date('2026-10-01T08:30:00.000Z'),
        valid: true,
        service: 'VIES',
        confirmation: {},
    });
    for (const method of ['findByTenantId', 'listForTenants']) {
        const read = repo[method].bind(repo);
        repo[method] = (...args) => {
            seen.reads.push({ method, bypassed: bypassed > 0 });
            return read(...args);
        };
    }
    const tenants = {
        listTenants: async () => [],
        async getTenantDetail(slug) {
            seen.lookups.push({ slug, bypassed: bypassed > 0 });
            return TENANTS.includes(slug) ? { id: `t-${slug}`, slug, name: slug } : null;
        },
        setTenantActive: async () => null,
        listUsers: async () => [],
        listAudit: async () => [],
        listSubscriptions: async () => [],
    };
    const taxAdapter = {
        ...TEST_TAX_ADAPTER,
        checkVatId: async (vatId) => {
            seen.checked.push({ vatId, bypassed: bypassed > 0 });
            return checkVatId(vatId);
        },
    };
    const root = SaaSiCatModule.forRoot({
        adapters: { secretSealer: storeSecretsInPlainText() },
        planCatalog: adapter ? { ...CATALOG, ...TAX_SETTINGS } : { ...CATALOG, vatRate: 19 },
        ...(adapter
            ? { tax: { adapter: { adapterName: 'test-tax', create: () => taxAdapter } } }
            : {}),
        controller: { guards: [] },
        discoverySnapshotPath: null,
        persistence: {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: true,
                advisoryLocks: false,
            },
            core: {
                mfa: {},
                audit: {
                    write: async (entry) => {
                        seen.audited.push(entry);
                    },
                },
                rlsBypass,
                transactionRunner: { run: (fn) => fn({}) },
            },
            entitlement: {
                subscriptionRepository: { findByTenantId: async () => null },
                planVersionRepository: { findById: async () => null },
                ...(subscribers ? { subscriberRepository: repo } : {}),
            },
            adminResources: { resources: tenants },
        },
        adminResources,
    });
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    const manifest = await moduleRef.get(AdminManifestService).getManifest();
    const handlers = controllersIn(root).flatMap(handlersOf);
    const served = (route) => handlers.find((handler) => handler.route === route);
    /** Asks a route the way Nest dispatches to it. */
    const call =
        (route) =>
        (...args) => {
            const handler = served(route);
            return moduleRef.get(handler.controller, { strict: false })[handler.name](...args);
        };
    return {
        moduleRef,
        manifest,
        seen,
        repo,
        served,
        call,
        subscriberOf: (slug) => call(SUBSCRIBER_ROUTE)(slug),
        attention: (tenantId) => call(ATTENTION_ROUTE)({ tenantId }),
    };
}
