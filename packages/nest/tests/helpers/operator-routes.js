// The routes `SaaSiCatModule.forRoot` mounts, read from the module graph it returns.
//
// Walking the graph rather than listing controllers is what lets a check about
// every operator route hold a composer that mounts one later, without anybody
// remembering to add it to a list.

import 'reflect-metadata';

import { SAASICAT_PUBLIC_ROUTE_KEY, SaaSiCatModule } from '../../dist/platform/index.js';

/** Nest's own metadata keys. */
export const PATH = 'path';
export const METHOD = 'method';
export const GUARDS = '__guards__';
const CONTROLLERS = 'controllers';
const IMPORTS = 'imports';

/** Establishes a caller and nothing else, the way an application's JWT guard does. */
export class SignedInGuard {
    canActivate() {
        return true;
    }
}

const REPO = {};
const PORT = {};

/** The options behind `everythingOn`, for a test that needs to change one of them. */
export function everythingOnOptions(guards = [SignedInGuard]) {
    const persistence = {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: false,
            advisoryLocks: false,
        },
        core: {
            mfa: PORT,
            audit: PORT,
            rlsBypass: PORT,
            transactionRunner: PORT,
            superAdminProvisioning: PORT,
            auditStats: PORT,
        },
        catalog: {
            planRepository: REPO,
            bundleRepository: REPO,
            catalogEntryRepository: REPO,
            marketingProjectionRepository: REPO,
            promotionRepository: REPO,
            marketingSettingsRepository: REPO,
        },
        entitlement: {
            subscriptionRepository: REPO,
            planVersionRepository: REPO,
            subscriptionBundleRepository: REPO,
            subscriptionContractRepository: REPO,
            subscriberRepository: REPO,
            subscriberLedgerRepository: REPO,
        },
        adminResources: { resources: REPO },
        promo: {
            promoCodeRepository: REPO,
            redemptionRepository: REPO,
            validationLogRepository: REPO,
            subscriptionLookup: REPO,
            revenueAggregator: REPO,
        },
        tenantBilling: { subscriptionWritePort: PORT, usageSnapshotPort: PORT },
    };
    return {
        planCatalog: {
            schemaVersion: 1,
            app: { name: 'Probe', version: '0.0.1' },
            currency: 'EUR',
            vatRate: 19,
            tenantBilling: {
                cancellationNoticeDays: { monthly: 0, yearly: 0 },
                selfServiceBlockedPlans: { asTarget: [], asSource: [] },
            },
            plans: [],
        },
        controller: { guards },
        discoverySnapshotPath: null,
        persistence,
        catalog: { featureUiRegistry: {} },
        adminResources: true,
        tenantBilling: {
            authGuards: guards,
            // Tenant billing resolves its guards from its own scope, where an
            // application provides them.
            extraProviders: guards,
            contractFreeze: {
                sourcePort: PORT,
                subscriptionContractRepository: REPO,
                subscriberRepository: REPO,
            },
            chargeJournal: { ledgerRepository: REPO },
        },
        promoCodes: true,
        setup: true,
        adminStats: {
            subscriptionStatsPort: PORT,
            promoCodeStatsPort: PORT,
        },
        subscriptionContract: true,
        tenantManifest: true,
        defaultPlanId: 'STARTER',
    };
}

/** Every optional feature on and every port bound, so every composer mounts what it can. */
export function everythingOn(guards = [SignedInGuard]) {
    return SaaSiCatModule.forRoot(everythingOnOptions(guards));
}

/** Every controller class reachable from a module, through dynamic and static imports alike. */
export function controllersIn(root) {
    const seen = new Set();
    const found = new Set();
    const visit = (node) => {
        if (node === null || node === undefined || seen.has(node)) return;
        if (node instanceof Promise || 'forwardRef' in node) return;
        seen.add(node);
        const moduleClass = typeof node === 'function' ? node : node.module;
        const declared = (key) => [
            ...(typeof node === 'function' ? [] : (node[key] ?? [])),
            ...(Reflect.getMetadata(key, moduleClass) ?? []),
        ];
        for (const controller of declared(CONTROLLERS)) found.add(controller);
        for (const imported of declared(IMPORTS)) visit(imported);
    };
    visit(root);
    return [...found];
}

const withoutLeadingSlash = (path) => (path.startsWith('/') ? path.slice(1) : path);

export const pathOf = (controller) =>
    withoutLeadingSlash(String(Reflect.getMetadata(PATH, controller) ?? ''));
export const guardsOf = (controller) => Reflect.getMetadata(GUARDS, controller) ?? [];
export const isPublic = (controller) =>
    Reflect.getMetadata(SAASICAT_PUBLIC_ROUTE_KEY, controller) === true;
export const isOperatorRoute = (controller) =>
    (pathOf(controller) === 'admin' || pathOf(controller).startsWith('admin/')) &&
    !isPublic(controller);

/** Nest's `RequestMethod` enum, by number. */
const VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];

/**
 * Every route handler a controller declares, as `VERB path` with the
 * controller's path in front, beside the function Nest reads its metadata from.
 */
export function handlersOf(controller) {
    const prototype = controller.prototype;
    return Object.getOwnPropertyNames(prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => ({ name, handler: prototype[name] }))
        .filter(({ handler }) => Reflect.getMetadata(PATH, handler) !== undefined)
        .map(({ name, handler }) => {
            const own = withoutLeadingSlash(String(Reflect.getMetadata(PATH, handler)));
            const path = [pathOf(controller), own].filter(Boolean).join('/');
            const verb = VERBS[Reflect.getMetadata(METHOD, handler) ?? 0];
            return { controller, name, handler, route: `${verb} ${path}` };
        });
}
