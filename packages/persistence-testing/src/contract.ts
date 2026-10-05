// The executable persistence contract. Every adapter runs the SAME
// scenarios against its real database — this is what makes "functionally
// equivalent adapters" a verified claim instead of prose.
//
// Scenario groups gate on adapter capabilities and slices. A group the
// adapter's capabilities rule out is registered as skipped with the reason. A
// group whose port or seed writer is missing fails, unless the adapter names
// it in `gaps`: a skip is easy to read past in a green run, and a harness that
// forgot to wire a port it ships would otherwise pass without checking it.

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test, type TestContext } from 'node:test';
import type {
    NewSubscriberCharge,
    AppliedSettingsValues,
    ConfirmedPaymentMethod,
    CreateCheckoutOfferData,
    NewMaintenanceWindow,
    CreateSubscriberData,
    ImmediatePlanChangeInput,
    NewContractLineItemData,
    NewSubscriptionContractData,
    PaymentEventClaim,
    RecordSubscriberPaymentMethodData,
    ScheduledPlanChangeInput,
    SubscriberPaymentMethodRecord,
    SubscriberPaymentMethodReference,
    SubscriptionContractParties,
    NewBundleVersionRetirement,
    TaxTreatment,
    VatIdCheck,
    NewVersionRetirement,
    NoticeToRecord,
    SubscriptionNoticeKey,
    SubscriptionNoticeRepository,
    TransactionContext,
    VersionRetirementRepository,
    BundleVersionRetirementRepository,
} from '@saasicat/core';
import {
    BILLING_ERROR_CODES,
    CATALOG_ERROR_CODES,
    CONTRACT_ERROR_CODES,
    PROMO_ERROR_CODES,
    isPersistenceRefusal,
} from '@saasicat/core';
import type {
    ContractGap,
    PersistenceAdapterContractOptions,
    PersistenceContractHarness,
} from './harness.types.js';

const LOCK_HOLD_MS = 150;

/** A tenant's user changing its billing details, tagged as the audit log tags them. */
const TENANT_USER = 'web:owner@tenant.example:tenant-self-service';

/** An id no version carries. */
const NO_SUCH_VERSION = '00000000-0000-4000-8000-000000000000';

/** An id no booking carries. */
const NO_SUCH_BOOKING = '00000000-0000-4000-8000-000000000001';

/** A plan draft on `planKey`, starting on `validFrom`. */
function planDraft(planKey: string, validFrom: string) {
    return {
        planId: planKey,
        features: ['CORE'],
        quotas: {},
        monthlyNet: '10.00',
        yearlyNet: '100.00',
        validFrom,
    };
}

/** What a publication records, starting on `validFrom`. */
function publishedOn(validFrom: string, publishedByUserId: string | null) {
    return {
        publishedByUserId,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: new Date(`${validFrom}T00:00:00.000Z`),
        validUntil: null,
    };
}

/**
 * An `assert.rejects` validator: refused by the adapter with the platform's
 * `code`, and with `params` where they are given.
 */
function refusedAs(
    code: string,
    params?: Readonly<Record<string, unknown>>,
): (error: unknown) => true {
    return (error) => {
        assert.ok(isPersistenceRefusal(error), `a PersistenceRefusal, not ${String(error)}`);
        assert.equal(error.code, code);
        if (params) assert.deepEqual(error.params, params);
        return true;
    };
}

/** An offer as a pricing page stores it: one plan line, priced. */
const OFFER: CreateCheckoutOfferData = {
    planKey: 'STANDARD',
    planVersionId: null,
    billingCycle: 'monthly',
    priceBreakdown: {
        currency: 'EUR',
        billingCycle: 'monthly',
        planNet: 49,
        bundlesNet: 0,
        regularNet: 49,
        effectiveNet: 49,
        vatRate: 19,
        effectiveGross: 58.31,
    },
};

/** The parties of a contract with the subscriber `subscriberId`, as copied at conclusion. */
function partiesWith(subscriberId: string, legalName: string): SubscriptionContractParties {
    return {
        subscriberId,
        subscriber: {
            customerNumber: 'K-10001',
            legalName,
            vatId: 'DE123456789',
            taxNumber: null,
            addressLine1: 'Hauptstraße 1',
            addressLine2: null,
            postalCode: '10115',
            city: 'Berlin',
            country: 'DE',
        },
        issuer: {
            legalName: 'Example Software GmbH',
            vatId: 'DE987654321',
            taxNumber: '12/345/67890',
            addressLine1: 'Werkstraße 5',
            addressLine2: null,
            postalCode: '80331',
            city: 'München',
            country: 'DE',
        },
    };
}

/** A gateway event at `gatewayAccount`, as the log records it. */
function eventAt(
    gatewayAccount: string,
    eventId: string,
    about: Partial<PaymentEventClaim> = {},
): PaymentEventClaim {
    return {
        gatewayAccount,
        eventId,
        provider: 'stripe',
        sessionId: `cs_${eventId}`,
        kind: 'payment-method-confirmed',
        summary: { type: 'card', last4: '4242' },
        ...about,
    };
}

/** A card confirmed at `gatewayAccount` under `paymentMethodRef`, every optional detail unknown but the ones a card has. */
const CARD: ConfirmedPaymentMethod = {
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2030,
    country: null,
    bankCode: null,
    mandateReference: null,
    customerRef: 'cus_1',
    paymentMethodRef: 'pm_card',
};

function paymentMethodFor(
    subscriberId: string,
    paymentMethodRef: string,
    confirmedAt: string,
    gatewayAccount = 'stripe-main',
): RecordSubscriberPaymentMethodData {
    return {
        ...CARD,
        paymentMethodRef,
        subscriberId,
        gatewayAccount,
        provider: 'stripe',
        confirmedAt: new Date(confirmedAt),
    };
}

/** Which payment method to ask about: a subscriber, an account, a reference. */
function reference(
    subscriberId: string,
    paymentMethodRef: string,
    gatewayAccount = 'stripe-main',
): SubscriberPaymentMethodReference {
    return { subscriberId, gatewayAccount, paymentMethodRef };
}

/** A new subscriber for the tenant `tenantId`, every detail but the legal name unknown. */
function subscriberFor(tenantId: string, legalName: string): CreateSubscriberData {
    return {
        tenantId,
        legalName,
        vatId: null,
        taxNumber: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        country: null,
        invoiceEmail: null,
        business: null,
        customerNumberPrefix: '',
    };
}

/** The contract concluded from the offer `offerId`: one plan line, as agreed. */
function contractFromOffer(
    offerId: string,
    parties: SubscriptionContractParties,
): NewSubscriptionContractData {
    return {
        tenantId: `tenant-${offerId}`,
        parties,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        originalOfferId: offerId,
        priceSnapshot: {
            currency: 'EUR',
            billingCycle: 'monthly',
            subtotalNet: 49,
            discountNet: 0,
            totalNet: 49,
            vatRate: 19,
            totalGross: 58.31,
        },
        lineItems: [
            {
                kind: 'plan',
                sourceKey: 'STANDARD',
                sourceVersionId: null,
                titleSnapshot: 'Standard',
                descriptionSnapshot: null,
                quantity: 1,
                unit: null,
                priceNet: 49,
                priceGross: 58.31,
                billingCycle: 'monthly',
                currency: 'EUR',
                taxRate: 19,
                taxAmount: 9.31,
                minimumTermUntil: null,
                featuresSnapshot: [],
                quotaEffectsSnapshot: {},
                metadata: null,
            },
        ],
    };
}

/**
 * What each gap stands for: the reason a skipped scenario reports, and whether
 * a harness provides it. `present` asks for the same members the gated
 * scenarios check, so a gap declared for a part the harness wires is caught.
 */
const CONTRACT_GAPS: Record<
    ContractGap,
    { reason: string; present(harness: PersistenceContractHarness): boolean }
> = {
    atomicPlanBinding: {
        reason: 'adapter does not expose atomic plan-binding writes',
        present: ({ adapter }) => Boolean(adapter.tenantSubscriptionWrite),
    },
    atomicOnboarding: {
        reason: 'adapter does not expose atomic onboarding writes',
        present: ({ adapter }) =>
            Boolean(adapter.tenantSubscriptionWrite?.applyOnboardingSelection),
    },
    promoCodes: {
        reason: 'adapter provides no PromoCodeRepository',
        present: ({ adapter }) => Boolean(adapter.promoCodeRepository),
    },
    promoCodeRedemptions: {
        reason: 'adapter provides no PromoCodeRedemptionRepository',
        present: ({ adapter }) => Boolean(adapter.promoCodeRedemptionRepository),
    },
    promoCodeHolds: {
        reason: 'adapter provides no PromoCodeHoldRepository beside its PromoCodeRepository',
        present: ({ adapter }) =>
            Boolean(adapter.promoCodeHoldRepository && adapter.promoCodeRepository),
    },
    promoSubscriptionLookup: {
        reason: 'adapter provides no PromoSubscriptionLookup',
        present: ({ adapter }) => Boolean(adapter.promoSubscriptionLookup),
    },
    planRepository: {
        reason: 'adapter provides no PlanRepository',
        present: ({ adapter }) => Boolean(adapter.planRepository),
    },
    planCatalogRead: {
        reason: 'adapter provides no PlanCatalogReadSink beside a PlanRepository that publishes and ends versions',
        present: ({ adapter }) => {
            const repository = adapter.planRepository;
            return Boolean(
                adapter.planCatalogReadSink &&
                repository?.createPlanVersionDraft &&
                repository.publishPlanVersionDraft &&
                repository.findActivePlanVersion &&
                repository.terminate,
            );
        },
    },
    planLifecycle: {
        reason: 'adapter provides no time-aware PlanRepository lifecycle',
        present: ({ adapter }) => {
            const repository = adapter.planRepository;
            return Boolean(
                repository?.createPlanVersionDraft &&
                repository.publishPlanVersionDraft &&
                repository.findVersionById &&
                repository.findActivePlanVersion,
            );
        },
    },
    planRetirement: {
        reason: 'adapter provides no PlanRepository that retires and finds plans by key',
        present: ({ adapter }) =>
            Boolean(adapter.planRepository?.softDelete && adapter.planRepository.findByKey),
    },
    planVersionReads: {
        reason: 'adapter provides no PlanRepository that reads versions by plan key',
        present: ({ adapter }) => {
            const repository = adapter.planRepository;
            return Boolean(
                repository?.listVersions &&
                repository.findCurrentDraft &&
                repository.findLatestLivePlanVersion,
            );
        },
    },
    planVersionRetirement: {
        reason: 'adapter provides no PlanRepository that reads versions and retires plans',
        present: ({ adapter }) => {
            const repository = adapter.planRepository;
            return Boolean(
                repository?.createPlanVersionDraft &&
                repository.publishPlanVersionDraft &&
                repository.listVersions &&
                repository.findCurrentDraft &&
                repository.findLatestLivePlanVersion &&
                repository.softDelete,
            );
        },
    },
    bundleRepository: {
        reason: 'adapter provides no BundleRepository',
        present: ({ adapter }) => Boolean(adapter.bundleRepository),
    },
    bundleValidity: {
        reason: 'adapter provides no time-aware BundleRepository',
        present: ({ adapter }) => Boolean(adapter.bundleRepository?.findActiveBundleVersion),
    },
    bundleDraftDiscard: {
        reason: 'adapter provides no BundleRepository that discards drafts',
        present: ({ adapter }) => Boolean(adapter.bundleRepository?.deleteDraft),
    },
    bundleDraftPublish: {
        reason: 'adapter provides no BundleRepository that publishes drafts',
        present: ({ adapter }) => Boolean(adapter.bundleRepository?.publishDraft),
    },
    planDraftPublish: {
        reason: 'adapter provides no PlanRepository that creates, publishes and reads drafts',
        present: ({ adapter }) => {
            const repository = adapter.planRepository;
            return Boolean(
                repository?.createPlanVersionDraft &&
                repository.publishPlanVersionDraft &&
                repository.findVersionById,
            );
        },
    },
    planDraftDiscard: {
        reason: 'adapter provides no PlanRepository that discards drafts',
        present: ({ adapter }) => {
            const repository = adapter.planRepository;
            return Boolean(
                repository?.createPlanVersionDraft &&
                repository.publishPlanVersionDraft &&
                repository.findVersionById &&
                repository.deletePlanVersionDraft,
            );
        },
    },
    bundleRetirement: {
        reason: 'adapter provides no BundleRepository that retires and finds bundles by key',
        present: ({ adapter }) =>
            Boolean(adapter.bundleRepository?.softDelete && adapter.bundleRepository.findByKey),
    },
    bundleBookings: {
        reason: 'adapter provides no SubscriptionBundleRepository or bundle catalog',
        present: ({ adapter, seed }) =>
            Boolean(adapter.subscriptionBundleRepository && seed.createBundleVersion),
    },
    halfCancelledBookingSeed: {
        reason: 'adapter harness cannot write the half-cancelled shape',
        present: ({ seed }) => Boolean(seed.clearBookingRequestDate),
    },
    foreignBookingCycleSeed: {
        reason: 'adapter harness cannot write a rhythm the platform never writes',
        present: ({ seed }) => Boolean(seed.setBookingCycle),
    },
    countByPlanVersionId: {
        reason: 'adapter does not implement countByPlanVersionId (fail-closed fallback)',
        present: ({ adapter }) => Boolean(adapter.subscriptionRepository.countByPlanVersionId),
    },
    audit: {
        reason: 'adapter provides no AuditPort/AuditQueryPort pair',
        present: ({ adapter }) => Boolean(adapter.audit && adapter.auditQuery),
    },
    mfa: {
        reason: 'adapter provides no MfaPort',
        present: ({ adapter }) => Boolean(adapter.mfa),
    },
    subscriptionContracts: {
        reason: 'adapter provides no SubscriptionContractRepository, or no subscriber seed for it',
        present: ({ adapter, seed }) =>
            Boolean(adapter.subscriptionContractRepository && seed.createSubscriber),
    },
    subscribers: {
        reason: 'adapter provides no SubscriberRepository',
        present: ({ adapter }) => Boolean(adapter.subscriberRepository),
    },
    paymentEventLog: {
        reason: 'adapter provides no PaymentEventLog',
        present: ({ adapter }) => Boolean(adapter.paymentEventLog),
    },
    subscriberPaymentMethods: {
        reason: 'adapter provides no SubscriberPaymentMethodRepository, or no subscriber seed for it',
        present: ({ adapter, seed }) =>
            Boolean(adapter.subscriberPaymentMethodRepository && seed.createSubscriber),
    },
    subscriberLedger: {
        reason: 'adapter provides no SubscriberLedgerRepository, or no contracts and subscriber seed for it',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriberLedgerRepository &&
                adapter.subscriptionContractRepository &&
                seed.createSubscriber,
            ),
    },
    checkoutOffers: {
        reason: 'adapter provides no CheckoutOfferRepository',
        present: ({ adapter }) => Boolean(adapter.checkoutOfferRepository),
    },
    appliedSettings: {
        reason: 'adapter provides no AppliedSettingsPort',
        present: ({ adapter }) => Boolean(adapter.appliedSettings),
    },
    maintenanceWindows: {
        reason: 'adapter provides no MaintenanceWindowPort',
        present: ({ adapter }) => Boolean(adapter.maintenanceWindows),
    },
    subscriptionNotices: {
        reason: 'adapter provides no SubscriptionNoticeRepository',
        present: ({ adapter }) => Boolean(adapter.subscriptionNotices),
    },
    versionRetirements: {
        reason: 'adapter provides no VersionRetirementRepository',
        present: ({ adapter }) => Boolean(adapter.versionRetirements),
    },
    boundSubscriptions: {
        reason: 'adapter provides no SubscriptionUsagePort that lists a version',
        present: ({ adapter }) => Boolean(adapter.subscriptionUsage?.listBoundToVersion),
    },
    bundleVersionRetirements: {
        reason: 'adapter provides no BundleVersionRetirementRepository',
        present: ({ adapter }) => Boolean(adapter.bundleVersionRetirements),
    },
    bookingsOfVersion: {
        reason: 'adapter provides no SubscriptionBundleRepository that lists an add-on version',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriptionBundleRepository?.listOfVersion && seed.createBundleVersion,
            ),
    },
    bookingsMoved: {
        reason: 'adapter provides no SubscriptionBundleRepository that moves a booking to another version',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriptionBundleRepository?.moveToVersion && seed.createBundleVersion,
            ),
    },
    subscriptionsById: {
        reason: 'adapter provides no SubscriptionUsagePort that reads subscriptions by id',
        present: ({ adapter }) => Boolean(adapter.subscriptionUsage?.listByIds),
    },
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs a write and answers what it answered, and the window of time it ran in. */
async function timed<T>(
    write: () => Promise<T>,
): Promise<{ result: T; from: number; until: number }> {
    const from = Date.now();
    const result = await write();
    return { result, from, until: Date.now() };
}

/** Whether `date` falls inside the window a timed write ran in. */
function inWindow(date: Date, window: { from: number; until: number }): boolean {
    return date.getTime() >= window.from && date.getTime() <= window.until;
}

/** A moment `days` from now; negative for the past. */
function inDays(days: number): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Registers the contract suite on the ambient `node:test` runner:
 *
 * ```ts
 * persistenceAdapterContract({
 *     name: 'adapter-prisma @ postgres',
 *     create: () => createPrismaHarness(),
 * });
 * ```
 */
export function persistenceAdapterContract(options: PersistenceAdapterContractOptions): void {
    const declaredGaps = new Set<ContractGap>(options.gaps ?? []);
    let harness: PersistenceContractHarness;

    /**
     * Ends a scenario whose part the harness does not provide: as a skip when
     * the adapter declared the gap, as a failure naming the declaration when it
     * did not.
     *
     * Each scenario states what it needs beside `CONTRACT_GAPS`, so the two can
     * disagree — about a member the harness wires but the scenario cannot call,
     * or after one of them is edited. Asked first, the registry turns that into
     * one failure saying so; otherwise the scenario would demand a declaration
     * the declaration check then rejects, and no `gaps` value would pass.
     */
    function missing(t: TestContext, gap: ContractGap): void {
        const { reason, present } = CONTRACT_GAPS[gap];
        if (present(harness)) {
            assert.fail(
                `'${gap}' counts as provided, yet this scenario found a member it needs missing ` +
                    'or not callable. Check that the harness wires the port itself; if it does, ' +
                    `the contract's check for '${gap}' and this scenario disagree, which is a ` +
                    'defect in @saasicat/persistence-testing.',
            );
        }
        if (declaredGaps.has(gap)) {
            t.skip(reason);
            return;
        }
        assert.fail(
            `${reason}. Wire it into the harness, or declare \`gaps: ['${gap}']\` in ` +
                'persistenceAdapterContract if the adapter deliberately does not provide it.',
        );
    }

    describe(`persistence adapter contract: ${options.name}`, () => {
        before(async () => {
            harness = await options.create();
        });
        after(async () => {
            await harness.close?.();
        });
        beforeEach(async () => {
            await harness.reset();
        });

        test('the declared gaps are exactly the parts the harness does not provide', () => {
            const gaps = Object.keys(CONTRACT_GAPS) as ContractGap[];
            const absent = gaps.filter((gap) => !CONTRACT_GAPS[gap].present(harness));
            // A plain JavaScript harness is not type-checked, so a misspelt name
            // arrives here; reported as wired, it would say the opposite of what it is.
            const known = (gap: string) => Object.prototype.hasOwnProperty.call(CONTRACT_GAPS, gap);
            const unknown = [...declaredGaps].filter((gap) => !known(gap));
            const stale = [...declaredGaps].filter((gap) => known(gap) && !absent.includes(gap));
            const undeclared = absent.filter((gap) => !declaredGaps.has(gap));
            const problems = [
                unknown.length > 0 &&
                    `declared as gaps but not parts of the contract: ${unknown.join(', ')} ` +
                        '(ContractGap lists the names)',
                stale.length > 0 &&
                    `declared as gaps but wired into the harness: ${stale.join(', ')}`,
                undeclared.length > 0 &&
                    `not wired into the harness and not declared as gaps: ${undeclared.join(', ')}`,
            ].filter(Boolean);
            assert.deepEqual(problems, [], problems.join('; '));
        });

        // -------------------------------------------------------------
        // Subscriptions + plan-version resolution
        // -------------------------------------------------------------

        test('findByTenantId returns the tenant subscription with plan-version limits', async () => {
            const { seed, adapter } = harness;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 5 },
                features: ['CORE'],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });

            const record = await adapter.subscriptionRepository.findByTenantId('tenant-a');
            assert.ok(record, 'subscription expected');
            assert.equal(record.tenantId, 'tenant-a');
            assert.equal(record.plan, 'STARTER');
            assert.equal(record.planVersionId, planVersionId);
            assert.deepEqual(record.planVersion.quotas, { users: 5 });
            assert.deepEqual(record.planVersion.features, ['CORE']);
        });

        test('a subscription carries its negotiated limits in the shape the platform applies', async () => {
            // `quotas[key]` replaces the plan's value, `features` adds to the
            // plan's. The stored JSON is handed back in that shape and no other:
            // an adapter that passes it through untyped hands the entitlement a
            // shape it reads nothing from.
            const { seed, adapter } = harness;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 5 },
                features: ['CORE'],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-negotiated',
                plan: 'STARTER',
                planVersionId,
                customLimits: { quotas: { users: 50, storage: -1 }, features: ['EXPORT'] },
            });
            await seed.createSubscription({
                tenantId: 'tenant-plain',
                plan: 'STARTER',
                planVersionId,
            });

            const negotiated =
                await adapter.subscriptionRepository.findByTenantId('tenant-negotiated');
            assert.deepEqual(negotiated?.customLimits, {
                quotas: { users: 50, storage: -1 },
                features: ['EXPORT'],
            });
            const plain = await adapter.subscriptionRepository.findByTenantId('tenant-plain');
            assert.equal(plain?.customLimits ?? null, null, 'none stored reads as none');
        });

        test('negotiated limits in a shape the platform does not read are left out', async () => {
            // `{ maxUsers: 20 }` is a shape one application stored before the
            // platform settled on `quotas`. Handed through, it reads as "no
            // override" without a word; the adapter keeps what it can read and
            // leaves the rest out, and says so in its log.
            const { seed, adapter } = harness;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 5 },
                features: ['CORE'],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-historical',
                plan: 'STARTER',
                planVersionId,
                customLimits: { maxUsers: 20, quotas: { users: 7, seats: 'many' } },
            });

            const record = await adapter.subscriptionRepository.findByTenantId('tenant-historical');
            // `seats` is left out rather than read as unlimited: the plan's value
            // applies, which is declared and can be counted.
            assert.deepEqual(record?.customLimits, { quotas: { users: 7 } });
        });

        test('findByTenantId is tenant-isolated', async () => {
            const { seed, adapter } = harness;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });

            assert.equal(await adapter.subscriptionRepository.findByTenantId('tenant-b'), null);
        });

        test('the entitlement read resolves the version on sale, not a draft, and the newest of several without dates', async () => {
            const { seed, adapter } = harness;
            await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: { users: 1 },
                features: [],
                published: true,
                superseded: true,
            });
            await seed.createPlanVersion({
                planKey: 'PRO',
                version: 2,
                quotas: { users: 2 },
                features: [],
                published: true,
            });
            await seed.createPlanVersion({
                planKey: 'PRO',
                version: 3,
                quotas: { users: 3 },
                features: [],
                published: false,
            });

            const live = await adapter.planVersionRepository.findActive('PRO', new Date());
            assert.ok(live, 'a version on sale expected');
            assert.equal(
                live.planId,
                'PRO',
                'port-facing plan identity must remain the semantic plan key',
            );
            assert.deepEqual(live.quotas, { users: 2 });
        });

        test('immediate plan change binds plan and active PlanVersion consistently', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.tenantSubscriptionWrite) {
                missing(t, 'atomicPlanBinding');
                return;
            }
            const oldVersion = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 2 },
                features: [],
                published: true,
            });
            const targetVersion = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: { users: 20 },
                features: ['PRO'],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-plan-change',
                plan: 'STARTER',
                planVersionId: oldVersion.planVersionId,
            });

            const change = await adapter.tenantSubscriptionWrite.changePlanImmediate(
                'tenant-plan-change',
                {
                    planId: 'PRO',
                    cycle: 'YEARLY',
                    periodStart: null,
                    periodEnd: null,
                    nextStatus: null,
                    // The row has no cancellation, so this claims it.
                    expectedCanceledAt: null,
                    keepsBoundVersion: false,
                    quotedPlanVersionId: null,
                },
            );
            assert.equal(change.claimed, true, 'the plan write did not claim the row');

            const changed =
                await adapter.subscriptionRepository.findByTenantId('tenant-plan-change');
            assert.ok(changed, 'changed subscription expected');
            assert.equal(changed.plan, 'PRO');
            assert.equal(changed.planVersionId, targetVersion.planVersionId);
            assert.equal(changed.planVersion.planId, 'PRO');
            // A contract freeze trusts this declaration at start, so it has to
            // say what the write just did.
            assert.notEqual(
                adapter.tenantSubscriptionWrite.bindsPlanVersion,
                false,
                'the write binds the version it sells but declares that it does not',
            );
        });

        test('a plan change binds the version on sale on the day it takes effect, not the newest published', async (t) => {
            const { seed, adapter } = harness;
            const repository = adapter.planRepository;
            if (!adapter.tenantSubscriptionWrite) {
                missing(t, 'atomicPlanBinding');
                return;
            }
            if (
                !repository?.createPlanVersionDraft ||
                !repository.publishPlanVersionDraft ||
                !repository.findActivePlanVersion
            ) {
                missing(t, 'planLifecycle');
                return;
            }
            const publish = async (
                draft: ReturnType<typeof planDraft> & { baseVersionId?: string },
                validFrom: string,
            ) =>
                repository.publishPlanVersionDraft!(
                    (await repository.createPlanVersionDraft!(draft)).id,
                    publishedOn(validFrom, null),
                );
            const current = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            await repository.create({ planKey: 'SCHEDULED', label: 'Scheduled' });
            const onSale = await publish(planDraft('SCHEDULED', '2026-01-01'), '2026-01-01');
            // Published as well, and the newest — but it starts in June.
            const fromJune = await publish(
                { ...planDraft('SCHEDULED', '2026-06-01'), baseVersionId: onSale.id },
                '2026-06-01',
            );

            const cases: Array<[string, string, string]> = [
                ['tenant-before-june', '2026-03-01', onSale.id],
                ['tenant-from-june', '2026-06-01', fromJune.id],
            ];
            for (const [tenantId, day, expected] of cases) {
                await seed.createSubscription({
                    tenantId,
                    plan: 'STARTER',
                    planVersionId: current.planVersionId,
                });
                const periodStart = new Date(`${day}T00:00:00.000Z`);
                const change = await adapter.tenantSubscriptionWrite.changePlanImmediate(tenantId, {
                    planId: 'SCHEDULED',
                    cycle: 'MONTHLY',
                    periodStart,
                    periodEnd: new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000),
                    nextStatus: null,
                    expectedCanceledAt: null,
                    keepsBoundVersion: false,
                    quotedPlanVersionId: null,
                });
                assert.equal(change.claimed, true, `the change for ${tenantId} claimed nothing`);
                assert.equal(
                    (await adapter.subscriptionRepository.findByTenantId(tenantId))?.planVersionId,
                    expected,
                    `a change taking effect on ${day} binds the version on sale that day`,
                );
            }
        });

        test('a plan change for a tenant without a subscription is refused as gone', async (t) => {
            const writer = harness.adapter.tenantSubscriptionWrite;
            if (!writer) {
                missing(t, 'atomicPlanBinding');
                return;
            }
            await assert.rejects(
                () =>
                    writer.changePlanImmediate('tenant-without-subscription', {
                        planId: 'PRO',
                        cycle: 'MONTHLY',
                        periodStart: null,
                        periodEnd: null,
                        nextStatus: null,
                        expectedCanceledAt: null,
                        keepsBoundVersion: false,
                        quotedPlanVersionId: null,
                    }),
                refusedAs(BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND, {
                    tenantId: 'tenant-without-subscription',
                }),
            );
        });

        test('a plan change to a plan with no version in effect is refused as gone', async (t) => {
            const { seed, adapter } = harness;
            const writer = adapter.tenantSubscriptionWrite;
            if (!writer) {
                missing(t, 'atomicPlanBinding');
                return;
            }
            if (writer.bindsPlanVersion === false) {
                t.skip('the write binds no plan version, so it asks for none');
                return;
            }
            const current = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            // The plan exists, with nothing published yet.
            await seed.createPlanVersion({
                planKey: 'UNRELEASED',
                version: 1,
                quotas: {},
                features: [],
                published: false,
            });
            await seed.createSubscription({
                tenantId: 'tenant-unreleased-plan',
                plan: 'STARTER',
                planVersionId: current.planVersionId,
            });
            await assert.rejects(
                () =>
                    writer.changePlanImmediate('tenant-unreleased-plan', {
                        planId: 'UNRELEASED',
                        cycle: 'MONTHLY',
                        periodStart: new Date('2026-05-01T00:00:00.000Z'),
                        periodEnd: new Date('2026-06-01T00:00:00.000Z'),
                        nextStatus: null,
                        expectedCanceledAt: null,
                        keepsBoundVersion: false,
                        quotedPlanVersionId: null,
                    }),
                refusedAs(BILLING_ERROR_CODES.NO_ACTIVE_PLAN_VERSION, {
                    planId: 'UNRELEASED',
                    asOf: '2026-05-01',
                }),
            );
            const unchanged =
                await adapter.subscriptionRepository.findByTenantId('tenant-unreleased-plan');
            assert.equal(unchanged?.plan, 'STARTER', 'nothing was written');
        });

        // @requirement SC-SUB-024
        describe('a change that leaves the plan as it is', () => {
            /** A tenant on LOYAL v1 while v2 is the version in effect. */
            async function onASupersededVersion(
                t: TestContext,
                tenantId: string,
            ): Promise<
                | {
                      writer: NonNullable<
                          PersistenceContractHarness['adapter']['tenantSubscriptionWrite']
                      >;
                      bound: string;
                      live: string;
                  }
                | undefined
            > {
                const { seed, adapter } = harness;
                const writer = adapter.tenantSubscriptionWrite;
                if (!writer) {
                    missing(t, 'atomicPlanBinding');
                    return undefined;
                }
                if (writer.bindsPlanVersion === false) {
                    t.skip('the write binds no plan version, so it keeps none either');
                    return undefined;
                }
                const bound = await seed.createPlanVersion({
                    planKey: 'LOYAL',
                    version: 1,
                    quotas: { users: 5 },
                    features: [],
                    published: true,
                });
                const live = await seed.createPlanVersion({
                    planKey: 'LOYAL',
                    version: 2,
                    quotas: { users: 10 },
                    features: [],
                    published: true,
                });
                await seed.createSubscription({
                    tenantId,
                    plan: 'LOYAL',
                    planVersionId: bound.planVersionId,
                });
                return { writer, bound: bound.planVersionId, live: live.planVersionId };
            }

            const toYearly = (keepsBoundVersion: boolean) => ({
                planId: 'LOYAL',
                cycle: 'YEARLY',
                periodStart: new Date('2026-05-01T00:00:00.000Z'),
                periodEnd: new Date('2027-05-01T00:00:00.000Z'),
                nextStatus: null,
                expectedCanceledAt: null,
                keepsBoundVersion,
                quotedPlanVersionId: null as string | null,
            });

            test('keeps the version the subscriber is bound to when the change moves only the rhythm', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-rhythm-only');
                if (!tenant) return;

                const change = await tenant.writer.changePlanImmediate(
                    'tenant-rhythm-only',
                    toYearly(true),
                );

                assert.equal(change.claimed, true);
                assert.equal(change.billingCycle, 'YEARLY');
                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-rhythm-only',
                    );
                assert.equal(after?.planVersionId, tenant.bound, 'still on the version bought');
            });

            test('binds the version in effect of another plan, whatever the change asks to keep', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-scheduled-downgrade');
                if (!tenant) return;
                const other = await harness.seed.createPlanVersion({
                    planKey: 'SMALLER',
                    version: 1,
                    quotas: { users: 2 },
                    features: [],
                    published: true,
                });

                await tenant.writer.changePlanImmediate('tenant-scheduled-downgrade', {
                    ...toYearly(true),
                    planId: 'SMALLER',
                });

                const after = await harness.adapter.subscriptionRepository.findByTenantId(
                    'tenant-scheduled-downgrade',
                );
                assert.equal(after?.plan, 'SMALLER');
                assert.equal(after?.planVersionId, other.planVersionId);
            });

            // @requirement SC-CHG-022
            test('binds another plan at the version it was quoted at, not one published since', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-quoted-version');
                if (!tenant) return;
                const quoted = await harness.seed.createPlanVersion({
                    planKey: 'SMALLER',
                    version: 1,
                    quotas: { users: 2 },
                    features: [],
                    published: true,
                });
                const publishedSince = await harness.seed.createPlanVersion({
                    planKey: 'SMALLER',
                    version: 2,
                    quotas: { users: 3 },
                    features: [],
                    published: true,
                });

                await tenant.writer.changePlanImmediate('tenant-quoted-version', {
                    ...toYearly(true),
                    planId: 'SMALLER',
                    quotedPlanVersionId: quoted.planVersionId,
                });

                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-quoted-version',
                    );
                assert.equal(after?.plan, 'SMALLER');
                assert.equal(after?.planVersionId, quoted.planVersionId, 'the version quoted');
                assert.notEqual(after?.planVersionId, publishedSince.planVersionId);
            });

            // @requirement SC-SUB-021
            test('binds a newer version of the same plan taken as an offer, not one published since', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-version-switch');
                if (!tenant) return;
                const publishedSince = await harness.seed.createPlanVersion({
                    planKey: 'LOYAL',
                    version: 3,
                    quotas: { users: 20 },
                    features: [],
                    published: true,
                });

                // The plan and the rhythm stay, and no window is opened: the
                // switch keeps the term, and only the version moves.
                const change = await tenant.writer.changePlanImmediate('tenant-version-switch', {
                    ...toYearly(false),
                    periodStart: null,
                    periodEnd: null,
                    quotedPlanVersionId: tenant.live,
                });

                assert.equal(change.claimed, true);
                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-version-switch',
                    );
                assert.equal(after?.plan, 'LOYAL');
                assert.equal(after?.planVersionId, tenant.live, 'the version taken');
                assert.notEqual(after?.planVersionId, publishedSince.planVersionId);
            });

            // @requirement SC-SUB-021
            test('keeps the version bound where a newer version of the same plan it names has ended by the day it lands', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-named-version-gone');
                if (!tenant) return;
                const end = harness.adapter.planRepository?.terminate?.bind(
                    harness.adapter.planRepository,
                );
                if (!end) {
                    t.skip('the plan repository ends no versions');
                    return;
                }
                const publishedSince = await harness.seed.createPlanVersion({
                    planKey: 'LOYAL',
                    version: 3,
                    quotas: { users: 20 },
                    features: [],
                    published: true,
                });
                // Taken while it was sold, ended before the term it was taken for.
                await end(tenant.live, new Date('2026-04-15T00:00:00.000Z'));

                const change = await tenant.writer.changePlanImmediate(
                    'tenant-named-version-gone',
                    {
                        ...toYearly(false),
                        quotedPlanVersionId: tenant.live,
                    },
                );

                assert.equal(change.claimed, true);
                const after = await harness.adapter.subscriptionRepository.findByTenantId(
                    'tenant-named-version-gone',
                );
                assert.equal(after?.planVersionId, tenant.bound, 'the version bought');
                assert.notEqual(after?.planVersionId, publishedSince.planVersionId);
            });

            // @requirement SC-SUB-021
            test('claims nothing where the binding moved since the caller read it', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-binding-moved');
                if (!tenant) return;

                // The caller read the subscription bound to the newer version;
                // it is on the older one, so the switch was decided from a
                // state that is not there.
                const change = await tenant.writer.changePlanImmediate('tenant-binding-moved', {
                    ...toYearly(false),
                    periodStart: null,
                    periodEnd: null,
                    quotedPlanVersionId: tenant.live,
                    expectedPlanVersionId: tenant.live,
                });

                assert.equal(change.claimed, false);
                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-binding-moved',
                    );
                assert.equal(after?.planVersionId, tenant.bound, 'nothing written');
            });

            // @requirement SC-SUB-021
            test('binds the version quoted or nothing, where the change asks for that version alone', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-quoted-only');
                if (!tenant) return;
                const end = harness.adapter.planRepository?.terminate?.bind(
                    harness.adapter.planRepository,
                );
                if (!end) {
                    t.skip('the plan repository ends no versions');
                    return;
                }
                // Ended after it was offered, before the switch is written.
                await end(tenant.live, new Date('2026-04-15T00:00:00.000Z'));

                const change = await tenant.writer.changePlanImmediate('tenant-quoted-only', {
                    ...toYearly(false),
                    periodStart: null,
                    periodEnd: null,
                    quotedPlanVersionId: tenant.live,
                    quotedVersionOnly: true,
                    expectedPlanVersionId: tenant.bound,
                });

                assert.equal(change.claimed, false);
                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-quoted-only',
                    );
                assert.equal(after?.planVersionId, tenant.bound, 'nothing written');
            });

            // @requirement SC-SUB-021
            test('a scheduled change claims the binding and the change already scheduled, where the caller names them', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-scheduled-claim');
                if (!tenant) return;
                const schedule = (
                    pendingPlan: string,
                    expected: Pick<
                        ScheduledPlanChangeInput,
                        'expectedPlanVersionId' | 'expectedPendingPlan'
                    >,
                ) =>
                    tenant.writer.schedulePlanChange('tenant-scheduled-claim', {
                        pendingPlan,
                        pendingBillingCycle: 'YEARLY',
                        pendingEffectiveAt: new Date('2027-05-01T00:00:00.000Z'),
                        pendingChangeVersionId: tenant.live,
                        expectedCanceledAt: null,
                        ...expected,
                    });

                const first = await schedule('LOYAL', {
                    expectedPlanVersionId: tenant.bound,
                    expectedPendingPlan: null,
                });
                // Something is scheduled now, and the caller read nothing.
                const overNothing = await schedule('OTHER', { expectedPendingPlan: null });
                // The binding the caller read is not the one there.
                const overAnotherBinding = await schedule('OTHER', {
                    expectedPlanVersionId: tenant.live,
                    expectedPendingPlan: 'LOYAL',
                });
                // What is there is what the first one wrote.
                const overWhatIsThere = await schedule('LOYAL', {
                    expectedPlanVersionId: tenant.bound,
                    expectedPendingPlan: 'LOYAL',
                });

                assert.deepEqual(
                    [first, overNothing, overAnotherBinding, overWhatIsThere].map((r) => r.claimed),
                    [true, false, false, true],
                );
            });

            // @requirement SC-SUB-031
            describe('a write that keeps the change the subscription scheduled', () => {
                /** A subscription on LOYAL's first version with `scheduled` waiting, moved to SUCCESSOR. */
                async function moved(
                    t: TestContext,
                    tenantId: string,
                    scheduled: (tenant: { live: string }) => {
                        pendingPlan: string;
                        pendingChangeVersionId: string | null;
                    },
                ) {
                    const tenant = await onASupersededVersion(t, tenantId);
                    const usage = harness.adapter.subscriptionUsage;
                    if (!tenant || !usage) {
                        if (tenant) t.skip('the adapter reads no subscription usage');
                        return null;
                    }
                    const successor = await harness.seed.createPlanVersion({
                        planKey: 'SUCCESSOR',
                        version: 1,
                        quotas: { users: 10 },
                        features: [],
                        published: true,
                    });
                    await tenant.writer.schedulePlanChange(tenantId, {
                        ...scheduled(tenant),
                        pendingBillingCycle: 'YEARLY',
                        pendingEffectiveAt: new Date('2027-05-01T00:00:00.000Z'),
                        expectedCanceledAt: null,
                    });
                    const change = await tenant.writer.changePlanImmediate(tenantId, {
                        planId: 'SUCCESSOR',
                        cycle: 'MONTHLY',
                        periodStart: null,
                        periodEnd: null,
                        nextStatus: null,
                        expectedCanceledAt: null,
                        expectedPlanVersionId: tenant.bound,
                        keepsBoundVersion: false,
                        quotedPlanVersionId: successor.planVersionId,
                        quotedVersionOnly: true,
                        keepsPendingChange: true,
                    });
                    assert.equal(change.claimed, true);
                    const after = await usage.findForTenant(tenantId);
                    assert.equal(after?.planVersion?.id, successor.planVersionId, 'moved');
                    return { after, tenant, usage, successor: successor.planVersionId };
                }

                /** The move undone: from `successor` back onto `quoted`, as a version of `planId`. */
                const putBack = (
                    planId: string,
                    quoted: string,
                    successor: string,
                    restoresQuotedVersion: boolean,
                ): ImmediatePlanChangeInput => ({
                    planId,
                    cycle: 'MONTHLY',
                    periodStart: null,
                    periodEnd: null,
                    nextStatus: null,
                    expectedCanceledAt: null,
                    expectedPlanVersionId: successor,
                    keepsBoundVersion: false,
                    quotedPlanVersionId: quoted,
                    quotedVersionOnly: true,
                    keepsPendingChange: true,
                    restoresQuotedVersion,
                });

                test('a change of rhythm on the plan it left follows it to the new plan', async (t) => {
                    const result = await moved(t, 'tenant-keeps-rhythm', () => ({
                        pendingPlan: 'LOYAL',
                        pendingChangeVersionId: null,
                    }));
                    if (!result) return;

                    assert.equal(result.after?.pendingPlan, 'SUCCESSOR');
                    assert.equal(result.after?.pendingBillingCycle, 'YEARLY');
                    assert.equal(
                        result.after?.pendingEffectiveAt?.toISOString(),
                        '2027-05-01T00:00:00.000Z',
                    );
                    assert.equal(result.after?.pendingChangeVersionId, null);
                });

                test('a change that names a version stays as it was scheduled', async (t) => {
                    const result = await moved(t, 'tenant-keeps-named', (tenant) => ({
                        pendingPlan: 'LOYAL',
                        pendingChangeVersionId: tenant.live,
                    }));
                    if (!result) return;

                    assert.equal(result.after?.pendingPlan, 'LOYAL');
                    assert.equal(result.after?.pendingChangeVersionId, result.tenant.live);
                    assert.equal(result.after?.pendingBillingCycle, 'YEARLY');
                });

                test('puts it back on the version it left, ended or not, with what it scheduled', async (t) => {
                    const repository = harness.adapter.planRepository;
                    const end = repository?.terminate?.bind(repository);
                    if (!end) {
                        t.skip('the plan repository ends no versions');
                        return;
                    }
                    const result = await moved(t, 'tenant-put-back', () => ({
                        pendingPlan: 'LOYAL',
                        pendingChangeVersionId: null,
                    }));
                    if (!result) return;
                    const { tenant, usage, successor } = result;
                    // Taken off sale by its own end: no booking takes it any more.
                    await end(tenant.bound, new Date('2026-04-15T00:00:00.000Z'));

                    const asABooking = await tenant.writer.changePlanImmediate(
                        'tenant-put-back',
                        putBack('LOYAL', tenant.bound, successor, false),
                    );
                    const asAPutBack = await tenant.writer.changePlanImmediate(
                        'tenant-put-back',
                        putBack('LOYAL', tenant.bound, successor, true),
                    );

                    assert.deepEqual([asABooking.claimed, asAPutBack.claimed], [false, true]);
                    const after = await usage.findForTenant('tenant-put-back');
                    assert.equal(after?.planVersion?.id, tenant.bound, 'back on the version left');
                    assert.equal(after?.plan, 'LOYAL');
                    assert.equal(after?.pendingPlan, 'LOYAL', 'the change of rhythm came back too');
                    assert.equal(after?.pendingBillingCycle, 'YEARLY');
                });

                test('puts back no version of another plan than the one it names', async (t) => {
                    const result = await moved(t, 'tenant-put-back-elsewhere', () => ({
                        pendingPlan: 'LOYAL',
                        pendingChangeVersionId: null,
                    }));
                    if (!result) return;
                    const { tenant, usage, successor } = result;

                    const change = await tenant.writer.changePlanImmediate(
                        'tenant-put-back-elsewhere',
                        putBack('SUCCESSOR', tenant.bound, successor, true),
                    );

                    assert.equal(change.claimed, false);
                    const after = await usage.findForTenant('tenant-put-back-elsewhere');
                    assert.equal(after?.planVersion?.id, successor, 'nothing written');
                });
            });

            test('a write that does not keep the change the subscription scheduled clears it', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-clears-change');
                const usage = harness.adapter.subscriptionUsage;
                if (!tenant || !usage) return;
                await tenant.writer.schedulePlanChange('tenant-clears-change', {
                    pendingPlan: 'LOYAL',
                    pendingBillingCycle: 'YEARLY',
                    pendingEffectiveAt: new Date('2027-05-01T00:00:00.000Z'),
                    pendingChangeVersionId: null,
                    expectedCanceledAt: null,
                });

                await tenant.writer.changePlanImmediate('tenant-clears-change', {
                    ...toYearly(false),
                    periodStart: null,
                    periodEnd: null,
                    quotedPlanVersionId: tenant.live,
                });

                const after = await usage.findForTenant('tenant-clears-change');
                assert.equal(after?.pendingPlan, null);
                assert.equal(after?.pendingEffectiveAt, null);
            });

            // @requirement SC-PLAN-016
            test('binds the version in effect where the version quoted has ended by the day it lands', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-quoted-ended');
                if (!tenant) return;
                const repository = harness.adapter.planRepository;
                const end = repository?.terminate?.bind(repository);
                if (!end) {
                    t.skip('the plan repository ends no versions');
                    return;
                }
                const quoted = await harness.seed.createPlanVersion({
                    planKey: 'ENDING',
                    version: 1,
                    quotas: { users: 2 },
                    features: [],
                    published: true,
                });
                const inEffect = await harness.seed.createPlanVersion({
                    planKey: 'ENDING',
                    version: 2,
                    quotas: { users: 3 },
                    features: [],
                    published: true,
                });
                // Ended after the change was quoted, before it lands in May.
                await end(quoted.planVersionId, new Date('2026-04-15T00:00:00.000Z'));

                await tenant.writer.changePlanImmediate('tenant-quoted-ended', {
                    ...toYearly(true),
                    planId: 'ENDING',
                    quotedPlanVersionId: quoted.planVersionId,
                });

                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-quoted-ended',
                    );
                assert.equal(
                    after?.planVersionId,
                    inEffect.planVersionId,
                    'an ended version is booked',
                );
            });

            // @requirement SC-CHG-022
            test('does not bind a quoted version of another plan', async (t) => {
                // A due change read back with its plan and its version out of
                // step — a query of the installation's own, a row edited by
                // hand — binds the plan's version in effect, never a version
                // of a plan the subscription is not moving to.
                const tenant = await onASupersededVersion(t, 'tenant-quoted-elsewhere');
                if (!tenant) return;
                const inEffect = await harness.seed.createPlanVersion({
                    planKey: 'ELSEWHERE',
                    version: 1,
                    quotas: { users: 2 },
                    features: [],
                    published: true,
                });

                await tenant.writer.changePlanImmediate('tenant-quoted-elsewhere', {
                    ...toYearly(true),
                    planId: 'ELSEWHERE',
                    quotedPlanVersionId: tenant.live,
                });

                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-quoted-elsewhere',
                    );
                assert.equal(after?.plan, 'ELSEWHERE');
                assert.equal(after?.planVersionId, inEffect.planVersionId);
            });

            // @requirement SC-CHG-022
            test('binds a quoted version that has not begun only as far as a sale that day would', async (t) => {
                // Published ahead of its date, the next version is live before it
                // is in effect. A change quoted at it and landing before its date
                // binds what a sale on that day binds, not the price it will
                // have from its date on.
                const tenant = await onASupersededVersion(t, 'tenant-quoted-ahead');
                if (!tenant) return;
                const repository = harness.adapter.planRepository;
                if (
                    !repository?.create ||
                    !repository.createPlanVersionDraft ||
                    !repository.publishPlanVersionDraft
                ) {
                    t.skip('the plan repository publishes no versions with a date');
                    return;
                }
                await repository.create({ planKey: 'AHEAD', label: 'Ahead' });
                const publish = async (validFrom: string) => {
                    const draft = await repository.createPlanVersionDraft!({
                        planId: 'AHEAD',
                        features: [],
                        quotas: { users: 2 },
                        monthlyNet: '10.00',
                        yearlyNet: '100.00',
                        validFrom: validFrom.slice(0, 10),
                    });
                    return repository.publishPlanVersionDraft!(draft.id, {
                        publishedByUserId: null,
                        publishedChanges: [],
                        nonRegressive: true,
                        validFrom: new Date(validFrom),
                        validUntil: null,
                    });
                };
                await publish('2026-01-01T00:00:00.000Z');
                const ahead = await publish('2027-01-01T00:00:00.000Z');
                await harness.seed.createSubscription({
                    tenantId: 'tenant-sold-ahead',
                    plan: 'LOYAL',
                    planVersionId: tenant.bound,
                });

                await tenant.writer.changePlanImmediate('tenant-quoted-ahead', {
                    ...toYearly(true),
                    planId: 'AHEAD',
                    quotedPlanVersionId: ahead.id,
                });
                await tenant.writer.changePlanImmediate('tenant-sold-ahead', {
                    ...toYearly(false),
                    planId: 'AHEAD',
                });

                const quoted =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-quoted-ahead',
                    );
                const sold =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-sold-ahead',
                    );
                assert.equal(quoted?.planVersionId, sold?.planVersionId);
            });

            // @requirement SC-CHG-022
            test('keeps the version bound where the plan stays, whatever version is quoted', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-quoted-same-plan');
                if (!tenant) return;

                await tenant.writer.changePlanImmediate('tenant-quoted-same-plan', {
                    ...toYearly(true),
                    quotedPlanVersionId: tenant.live,
                });

                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-quoted-same-plan',
                    );
                assert.equal(after?.planVersionId, tenant.bound, 'still on the version bought');
            });

            test('binds the version in effect when the change is a sale', async (t) => {
                const tenant = await onASupersededVersion(t, 'tenant-sold-again');
                if (!tenant) return;

                await tenant.writer.changePlanImmediate('tenant-sold-again', toYearly(false));

                const after =
                    await harness.adapter.subscriptionRepository.findByTenantId(
                        'tenant-sold-again',
                    );
                assert.equal(after?.planVersionId, tenant.live);
            });
        });

        test('onboarding selection binds the version it sells, as the write declares', async (t) => {
            const { seed, adapter } = harness;
            const writer = adapter.tenantSubscriptionWrite;
            if (!writer?.applyOnboardingSelection) {
                missing(t, 'atomicOnboarding');
                return;
            }
            const oldVersion = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const targetVersion = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['PRO'],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-onboarding-binds',
                plan: 'STARTER',
                planVersionId: oldVersion.planVersionId,
            });

            await writer.applyOnboardingSelection(
                'tenant-onboarding-binds',
                {
                    planId: 'PRO',
                    cycle: 'MONTHLY',
                    periodStart: null,
                    periodEnd: null,
                    nextStatus: null,
                    expectedCanceledAt: null,
                },
                null,
            );

            const changed =
                await adapter.subscriptionRepository.findByTenantId('tenant-onboarding-binds');
            assert.ok(changed, 'changed subscription expected');
            assert.equal(changed.plan, 'PRO');
            assert.equal(changed.planVersionId, targetVersion.planVersionId);
            // The contract freeze runs after onboarding as it does after an
            // immediate change, and trusts the same declaration for both.
            assert.notEqual(
                writer.bindsPlanVersion,
                false,
                'the onboarding write binds the version it sells but declares that it does not',
            );
        });

        test('onboarding selection rolls plan binding and promo write back together', async (t) => {
            const { seed, adapter } = harness;
            const writer = adapter.tenantSubscriptionWrite;
            if (!writer?.applyOnboardingSelection) {
                missing(t, 'atomicOnboarding');
                return;
            }
            const redemptions = adapter.promoCodeRedemptionRepository;
            if (!redemptions) {
                missing(t, 'promoCodeRedemptions');
                return;
            }
            const oldVersion = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-onboarding-rollback',
                plan: 'STARTER',
                planVersionId: oldVersion.planVersionId,
            });
            const { promoCodeId } = await seed.createPromoCode({
                code: 'ONBOARDING-ROLLBACK',
                maxRedemptions: null,
            });
            const startsAt = new Date('2026-07-24T00:00:00.000Z');

            await assert.rejects(
                writer.applyOnboardingSelection(
                    'tenant-onboarding-rollback',
                    {
                        planId: 'PRO',
                        cycle: 'MONTHLY',
                        periodStart: null,
                        periodEnd: null,
                        nextStatus: null,
                        expectedCanceledAt: null,
                    },
                    async (tx, callbackSubscriptionId) => {
                        assert.equal(callbackSubscriptionId, subscriptionId);
                        await redemptions.create(
                            {
                                promoCodeId,
                                subscriptionId: callbackSubscriptionId,
                                tenantId: 'tenant-onboarding-rollback',
                                appliedValueType: 'PERCENT',
                                appliedValue: '10.00',
                                appliedDurationType: 'ONCE',
                                appliedDurationValue: null,
                                startsAt,
                                endsAt: null,
                            },
                            tx,
                        );
                        assert.ok(
                            await redemptions.findBySubscription(callbackSubscriptionId, tx),
                            'promo write must be visible inside the onboarding transaction',
                        );
                        throw new Error('promo redemption failed');
                    },
                ),
                /promo redemption failed/,
            );

            const unchanged = await adapter.subscriptionRepository.findByTenantId(
                'tenant-onboarding-rollback',
            );
            assert.ok(unchanged, 'subscription expected after rollback');
            assert.equal(unchanged.plan, 'STARTER');
            assert.equal(unchanged.planVersionId, oldVersion.planVersionId);
            assert.equal(unchanged.planVersion.planId, 'STARTER');
            assert.equal(
                await redemptions.findBySubscription(subscriptionId),
                null,
                'promo callback write must be rolled back',
            );
        });

        test('plan lifecycle keeps semantic identity and auto-succeeds validity windows', async (t) => {
            const repository = harness.adapter.planRepository;
            if (
                !repository?.createPlanVersionDraft ||
                !repository.publishPlanVersionDraft ||
                !repository.findVersionById ||
                !repository.findActivePlanVersion
            ) {
                missing(t, 'planLifecycle');
                return;
            }
            const plan = await repository.create({
                planKey: 'STANDARD',
                label: 'Standard',
            });
            assert.equal(plan.planKey, 'STANDARD');
            const firstDraft = await repository.createPlanVersionDraft({
                planId: 'STANDARD',
                features: ['CORE'],
                quotas: { users: 5 },
                monthlyNet: '10.00',
                yearlyNet: '100.00',
                validFrom: '2026-01-01',
            });
            assert.equal(firstDraft.planId, 'STANDARD');
            const first = await repository.publishPlanVersionDraft(firstDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });

            const secondDraft = await repository.createPlanVersionDraft({
                planId: 'STANDARD',
                baseVersionId: first.id,
                features: ['CORE', 'PLUS'],
                quotas: { users: 10 },
                monthlyNet: '15.00',
                yearlyNet: '150.00',
                validFrom: '2026-03-01',
            });
            const second = await repository.publishPlanVersionDraft(secondDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-03-01T00:00:00.000Z'),
                validUntil: null,
            });

            const succeeded = await repository.findVersionById(first.id);
            assert.ok(succeeded, 'predecessor expected');
            assert.ok(succeeded.supersededAt, 'predecessor must be superseded');
            assert.equal(succeeded.validUntil, '2026-02-28T00:00:00.000Z');
            assert.equal(succeeded.planId, 'STANDARD');
            assert.equal(
                (
                    await repository.findActivePlanVersion(
                        'STANDARD',
                        new Date('2026-02-28T23:59:59.999Z'),
                    )
                )?.id,
                first.id,
                'validUntil is day-inclusive',
            );
            assert.equal(
                (
                    await repository.findActivePlanVersion(
                        'STANDARD',
                        new Date('2026-03-01T00:00:00.000Z'),
                    )
                )?.id,
                second.id,
            );
        });

        // @requirement SC-PLAN-027
        test('the catalogue names the version on sale at the moment it is read, as a booking does', async (t) => {
            const repository = harness.adapter.planRepository;
            const sink = harness.adapter.planCatalogReadSink;
            if (
                !sink ||
                !repository?.createPlanVersionDraft ||
                !repository.publishPlanVersionDraft ||
                !repository.findActivePlanVersion ||
                !repository.terminate
            ) {
                missing(t, 'planCatalogRead');
                return;
            }
            const scenarioPlans = ['WINDOWED', 'ENDING', 'DRAFTED', 'LEGACY'];
            const onSaleAt = async (asOf: Date) =>
                Object.fromEntries(
                    (await sink.loadSnapshot(asOf)).versionsOnSale
                        .filter((row) => scenarioPlans.includes(row.planId))
                        .map((row) => [row.planId, row.id]),
                );
            const publish = async (
                draft: ReturnType<typeof planDraft> & { baseVersionId?: string },
                validFrom: string,
            ) =>
                repository.publishPlanVersionDraft!(
                    (await repository.createPlanVersionDraft!(draft)).id,
                    publishedOn(validFrom, null),
                );

            await repository.create({ planKey: 'WINDOWED', label: 'Windowed' });
            const first = await publish(planDraft('WINDOWED', '2026-01-01'), '2026-01-01');
            const second = await publish(
                { ...planDraft('WINDOWED', '2026-06-01'), baseVersionId: first.id },
                '2026-06-01',
            );
            await repository.create({ planKey: 'ENDING', label: 'Ending' });
            const ending = await publish(planDraft('ENDING', '2026-01-01'), '2026-01-01');
            await repository.terminate(ending.id, new Date('2026-04-01T00:00:00.000Z'));
            await repository.create({ planKey: 'DRAFTED', label: 'Drafted' });
            await repository.createPlanVersionDraft(planDraft('DRAFTED', '2026-01-01'));
            // Versions published while the dates were not kept carry none: the
            // newest of them is on sale until a dated successor starts.
            await repository.create({ planKey: 'LEGACY', label: 'Legacy' });
            const legacy = { planKey: 'LEGACY', quotas: {}, features: [], published: true };
            await harness.seed.createPlanVersion({ ...legacy, version: 1, superseded: true });
            const undated = await harness.seed.createPlanVersion({ ...legacy, version: 2 });
            const dated = await publish(planDraft('LEGACY', '2026-06-01'), '2026-06-01');

            const spring = new Date('2026-03-01T00:00:00.000Z');
            const summer = new Date('2026-06-01T00:00:00.000Z');
            assert.deepEqual(
                await onSaleAt(spring),
                { WINDOWED: first.id, ENDING: ending.id, LEGACY: undated.planVersionId },
                'the predecessor is on sale until the day its successor starts, and a draft never',
            );
            assert.deepEqual(
                await onSaleAt(summer),
                { WINDOWED: second.id, LEGACY: dated.id },
                'the successor from its first day, and an ended version no longer',
            );
            for (const asOf of [spring, summer]) {
                const catalogue = await onSaleAt(asOf);
                for (const planKey of ['WINDOWED', 'LEGACY']) {
                    assert.equal(
                        catalogue[planKey],
                        (await repository.findActivePlanVersion(planKey, asOf))?.id,
                        'the catalogue names the version a booking binds',
                    );
                }
            }

            // Ended, the newest version leaves nothing on sale: a superseded
            // version without a last day — as an import or an installation
            // without dates left it — does not come back at its old price.
            await repository.terminate(dated.id, new Date('2026-09-01T00:00:00.000Z'));
            const autumn = new Date('2026-10-01T00:00:00.000Z');
            assert.equal((await onSaleAt(autumn)).LEGACY, undefined, 'the catalogue names none');
            assert.equal(
                await repository.findActivePlanVersion('LEGACY', autumn),
                null,
                'and a booking finds none',
            );
        });

        test('bundle lifecycle roundtrips validity and auto-succeeds atomically', async (t) => {
            const repository = harness.adapter.bundleRepository;
            if (!repository?.findActiveBundleVersion) {
                missing(t, 'bundleValidity');
                return;
            }
            const bundle = await repository.create({
                bundleKey: 'REPORTING',
                label: 'Reporting',
            });
            assert.equal(bundle.bundleKey, 'REPORTING');
            const firstDraft = await repository.createDraft({
                bundleId: bundle.id,
                features: ['REPORTS'],
                quotas: {},
                validFrom: '2026-01-01',
            });
            const first = await repository.publishDraft(firstDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });

            const secondDraft = await repository.createDraft({
                bundleId: bundle.id,
                baseVersionId: first.id,
                features: ['REPORTS', 'EXPORTS'],
                quotas: {},
                validFrom: '2026-03-01',
            });
            const second = await repository.publishDraft(secondDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-03-01T00:00:00.000Z'),
                validUntil: null,
            });

            const succeeded = await repository.findVersionById(first.id);
            assert.ok(succeeded, 'predecessor expected');
            assert.ok(succeeded.supersededAt, 'predecessor must be superseded');
            assert.equal(succeeded.validUntil, '2026-02-28T00:00:00.000Z');
            assert.equal(
                (
                    await repository.findActiveBundleVersion(
                        bundle.id,
                        new Date('2026-02-28T23:59:59.999Z'),
                    )
                )?.id,
                first.id,
                'validUntil is day-inclusive',
            );
            assert.equal(
                (
                    await repository.findActiveBundleVersion(
                        bundle.id,
                        new Date('2026-03-01T00:00:00.000Z'),
                    )
                )?.id,
                second.id,
            );
        });

        test('a booking keeps the rhythm and the window it was made in', async (t) => {
            // The three columns a bundle's own period lives in. Before they
            // existed a booking was billed alongside the plan by convention,
            // which is exactly what a null still means — so the scenario proves
            // both readings survive a round trip through a real store, not just
            // the populated one.
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                missing(t, 'bundleBookings');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-bundle-period',
                plan: 'PRO',
                planVersionId,
                billingCycle: 'YEARLY',
            });
            const { bundleVersionId } = await seed.createBundleVersion({
                bundleKey: 'ANALYTICS',
                features: ['REPORTS'],
            });

            // A monthly bundle beside a yearly plan: the case the columns
            // exist for, and the one a convention cannot express.
            const booked = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-02-21T00:00:00.000Z'),
                minimumTermEndsAt: null,
                billingCycle: 'MONTHLY',
                currentPeriodStart: new Date('2026-02-21T00:00:00.000Z'),
                currentPeriodEnd: new Date('2026-02-28T00:00:00.000Z'),
            });
            assert.equal(booked.billingCycle, 'MONTHLY');

            const [readBack] = await repository.listBySubscription(subscriptionId);
            assert.ok(readBack, 'the booking must be readable back');
            assert.equal(readBack.billingCycle, 'MONTHLY');
            assert.equal(
                readBack.currentPeriodEnd?.toISOString(),
                '2026-02-28T00:00:00.000Z',
                'the period end must survive the round trip',
            );
            assert.equal(readBack.currentPeriodStart?.toISOString(), '2026-02-21T00:00:00.000Z');

            // A booking made before the columns existed: every one of them null,
            // read as "billed with the plan" rather than as a broken row.
            const legacy = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-01-01T00:00:00.000Z'),
                minimumTermEndsAt: null,
            });
            const legacyReadBack = await repository.findById(legacy.id);
            assert.ok(legacyReadBack, 'the legacy booking must be readable back');
            assert.equal(legacyReadBack.billingCycle, null);
            assert.equal(legacyReadBack.currentPeriodStart, null);
            assert.equal(legacyReadBack.currentPeriodEnd, null);
        });

        test('a booking whose rhythm is neither monthly nor yearly is refused when read', async (t) => {
            // A price is chosen by asking whether the rhythm is yearly, so any
            // other value would be billed monthly without a word. The column is
            // text; what keeps it to the two values is the adapter reading it.
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                missing(t, 'bundleBookings');
                return;
            }
            const setBookingCycle = seed.setBookingCycle;
            if (!setBookingCycle) {
                missing(t, 'foreignBookingCycleSeed');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-foreign-cycle',
                plan: 'PRO',
                planVersionId,
                billingCycle: 'YEARLY',
            });
            const { bundleVersionId } = await seed.createBundleVersion({
                bundleKey: 'ANALYTICS',
                features: ['REPORTS'],
            });
            const booking = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-02-21T00:00:00.000Z'),
                minimumTermEndsAt: null,
                billingCycle: 'YEARLY',
            });
            await setBookingCycle(booking.id, 'yearly');

            const namesTheRow = (error: unknown): boolean =>
                error instanceof Error &&
                error.message.includes(`'${booking.id}' holds billingCycle 'yearly'`);
            await assert.rejects(() => repository.findById(booking.id), namesTheRow);
            await assert.rejects(() => repository.listBySubscription(subscriptionId), namesTheRow);
            await assert.rejects(
                () =>
                    repository.listActiveBySubscription(
                        subscriptionId,
                        new Date('2026-03-01T00:00:00.000Z'),
                    ),
                namesTheRow,
            );
        });

        test('cancelling a booking that is not there is refused as gone', async (t) => {
            const repository = harness.adapter.subscriptionBundleRepository;
            if (!repository) {
                missing(t, 'bundleBookings');
                return;
            }
            await assert.rejects(
                () =>
                    repository.cancel(NO_SUCH_BOOKING, {
                        canceledAt: new Date('2026-03-01T00:00:00.000Z'),
                        canceledEffectiveAt: new Date('2026-04-01T00:00:00.000Z'),
                    }),
                refusedAs(BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_FOUND, {
                    subscriptionBundleId: NO_SUCH_BOOKING,
                }),
            );
        });

        test('a second cancellation of one booking is refused, not applied', async (t) => {
            // The port has always said this method throws on an already-
            // cancelled booking. Neither adapter did: both updated by id alone,
            // so two requests that pass the service's check together both
            // wrote, and the loser moved an effective date the tenant had
            // already been told — the one field in the row that decides when
            // they stop being billed.
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                missing(t, 'bundleBookings');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-double-cancel',
                plan: 'PRO',
                planVersionId,
            });
            const { bundleVersionId } = await seed.createBundleVersion({
                bundleKey: 'ANALYTICS',
                features: ['REPORTS'],
            });
            const booking = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-01-01T00:00:00.000Z'),
                minimumTermEndsAt: null,
            });

            const first = await repository.cancel(booking.id, {
                canceledAt: new Date('2026-03-01T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-04-01T00:00:00.000Z'),
            });
            assert.equal(first.canceledEffectiveAt?.toISOString(), '2026-04-01T00:00:00.000Z');

            await assert.rejects(
                () =>
                    repository.cancel(booking.id, {
                        canceledAt: new Date('2026-03-02T00:00:00.000Z'),
                        canceledEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
                    }),
                refusedAs(BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED, {
                    subscriptionBundleId: booking.id,
                }),
            );

            const readBack = await repository.findById(booking.id);
            assert.equal(
                readBack?.canceledEffectiveAt?.toISOString(),
                '2026-04-01T00:00:00.000Z',
                'the first cancellation must still stand',
            );

            // And undoing it makes the booking cancellable again, which is what
            // separates "refused because already cancelled" from "refused".
            await repository.reactivate(booking.id);
            const again = await repository.cancel(booking.id, {
                canceledAt: new Date('2026-03-02T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
            });
            assert.equal(again.canceledEffectiveAt?.toISOString(), '2026-09-01T00:00:00.000Z');
        });

        test("a subscription's bookings come back newest first", async (t) => {
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                missing(t, 'bundleBookings');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-booking-order',
                plan: 'PRO',
                planVersionId,
            });
            // Inserted oldest-first on purpose: without an ORDER BY a store is
            // free to hand them back in insertion order, and the assertion
            // below would then pass by accident.
            for (const [key, startedAt] of [
                ['OLDEST', '2026-01-01T00:00:00.000Z'],
                ['MIDDLE', '2026-02-01T00:00:00.000Z'],
                ['NEWEST', '2026-03-01T00:00:00.000Z'],
            ] as const) {
                const { bundleVersionId } = await seed.createBundleVersion({
                    bundleKey: key,
                    features: ['REPORTS'],
                });
                await repository.add({
                    subscriptionId,
                    bundleVersionId,
                    startedAt: new Date(startedAt),
                    minimumTermEndsAt: null,
                });
            }

            const listed = await repository.listBySubscription(subscriptionId);
            assert.deepEqual(
                listed.map((row) => row.startedAt.toISOString()),
                [
                    '2026-03-01T00:00:00.000Z',
                    '2026-02-01T00:00:00.000Z',
                    '2026-01-01T00:00:00.000Z',
                ],
            );
        });

        test('a booking with no request date is active, whatever its effective date says', async (t) => {
            // The port defines activity as `canceledAt IS NULL OR
            // canceledEffectiveAt > NOW()`. A row with no request date and a
            // past effective date satisfies the first half, and an adapter that
            // requires BOTH columns to be null instead reads it as inactive —
            // so the same tenant is granted less on one store than on another.
            // The shape is incoherent data; the point is that both answer it
            // the same way.
            const repository = harness.adapter.subscriptionBundleRepository;
            const { seed } = harness;
            if (!repository || !seed.createBundleVersion) {
                missing(t, 'bundleBookings');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: ['CORE'],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-half-cancelled',
                plan: 'PRO',
                planVersionId,
            });
            const { bundleVersionId } = await seed.createBundleVersion({
                bundleKey: 'ANALYTICS',
                features: ['REPORTS'],
            });
            const booking = await repository.add({
                subscriptionId,
                bundleVersionId,
                startedAt: new Date('2026-01-01T00:00:00.000Z'),
                minimumTermEndsAt: null,
            });
            // Cancel, then clear only the request date — the half-written state
            // the nullable columns permit.
            await repository.cancel(booking.id, {
                canceledAt: new Date('2026-02-01T00:00:00.000Z'),
                canceledEffectiveAt: new Date('2026-03-01T00:00:00.000Z'),
            });
            const clearRequestDate = harness.seed.clearBookingRequestDate;
            if (!clearRequestDate) {
                missing(t, 'halfCancelledBookingSeed');
                return;
            }
            await clearRequestDate(booking.id);

            const active = await repository.listActiveBySubscription(
                subscriptionId,
                new Date('2026-06-01T00:00:00.000Z'),
            );
            assert.equal(active.length, 1, 'no request date means nobody asked to cancel it');
            assert.equal(
                await repository.countActiveByBundleVersionId(
                    bundleVersionId,
                    new Date('2026-06-01T00:00:00.000Z'),
                ),
                1,
            );
        });

        test('discarding a draft cannot remove a version published meanwhile', async (t) => {
            // Read-then-delete-by-id leaves a window: a publish commits in
            // between and the delete removes a published version. It has no
            // bookings yet, so no foreign key stands in the way — the catalogue
            // entry is simply gone. Simulated here by publishing between the
            // caller's decision and the call, which is the same order the race
            // produces.
            const catalog = harness.adapter.bundleRepository;
            // Bound once so the narrowing survives into the arrow below: the
            // port makes `deleteDraft` optional, and TypeScript does not carry
            // a property check across a closure boundary.
            const discardDraft = catalog?.deleteDraft?.bind(catalog);
            if (!catalog || !discardDraft) {
                missing(t, 'bundleDraftDiscard');
                return;
            }
            const bundle = await catalog.create({
                bundleKey: 'RACE',
                label: 'Race',
            });
            const draft = await catalog.createDraft({
                bundleId: bundle.id,
                features: ['REPORTS'],
                quotas: {},
            });
            await catalog.publishDraft(draft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });

            await assert.rejects(
                () => discardDraft(draft.id),
                refusedAs(CATALOG_ERROR_CODES.BUNDLE_VERSION_ALREADY_PUBLISHED),
                'a published version must not be discardable',
            );
            assert.ok(
                await catalog.findVersionById(draft.id),
                'and it must still be there afterwards',
            );
        });

        test('publishing one draft twice claims it once, and the windows stay adjacent', async (t) => {
            // Two publications of the same draft with different validity dates.
            // Superseding the predecessor before claiming the draft lets both
            // do work: the first closes the predecessor with its own date, the
            // second finds no unsuperseded predecessor left and overwrites the
            // successor's `validFrom` with a different one — and the stored
            // windows are then a gap or an overlap that nothing can attribute.
            const catalog = harness.adapter.bundleRepository;
            const publish = catalog?.publishDraft?.bind(catalog);
            if (!catalog || !publish) {
                missing(t, 'bundleDraftPublish');
                return;
            }
            const bundle = await catalog.create({
                bundleKey: 'CLAIM',
                label: 'Claim',
            });
            const first = await catalog.createDraft({
                bundleId: bundle.id,
                features: ['A'],
                quotas: {},
            });
            await publish(first.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });
            const second = await catalog.createDraft({
                bundleId: bundle.id,
                baseVersionId: first.id,
                features: ['A', 'B'],
                quotas: {},
            });

            const publishedAt = new Date('2026-03-01T00:00:00.000Z');
            await publish(second.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: publishedAt,
                validUntil: null,
            });
            // The losing request, arriving with a different date.
            await assert.rejects(
                () =>
                    publish(second.id, {
                        publishedByUserId: null,
                        publishedChanges: [],
                        nonRegressive: true,
                        validFrom: new Date('2026-06-01T00:00:00.000Z'),
                        validUntil: null,
                    }),
                refusedAs(CATALOG_ERROR_CODES.BUNDLE_VERSION_ALREADY_PUBLISHED),
                'a version that is already published must not be published again',
            );

            const successor = await catalog.findVersionById(second.id);
            const predecessor = await catalog.findVersionById(first.id);
            assert.equal(
                successor?.validFrom && new Date(successor.validFrom).toISOString(),
                publishedAt.toISOString(),
                'the winning date must still stand',
            );
            assert.ok(predecessor?.supersededAt, 'the predecessor must be superseded');
            if (predecessor?.validUntil) {
                // Adjacent, not overlapping: the predecessor's last day is the
                // day before the successor opens.
                const closesAt = new Date(predecessor.validUntil);
                assert.equal(
                    closesAt.toISOString().slice(0, 10),
                    '2026-02-28',
                    'the predecessor must close the day before its successor opens',
                );
            }
        });

        test('publishing a bundle version that is not there is refused as gone', async (t) => {
            const catalog = harness.adapter.bundleRepository;
            const publish = catalog?.publishDraft?.bind(catalog);
            if (!catalog || !publish) {
                missing(t, 'bundleDraftPublish');
                return;
            }
            await assert.rejects(
                () => publish(NO_SUCH_VERSION, publishedOn('2026-01-01', null)),
                refusedAs(CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND),
            );
        });

        test('publishing one plan draft twice claims it once', async (t) => {
            // The plan twin of the bundle scenario above. Superseding the
            // predecessor before claiming the draft lets the second publication
            // write as well: it overwrites when, by whom and from when the
            // version was published — the record of what it promised — and
            // closes the predecessor a second time.
            const repository = harness.adapter.planRepository;
            const createDraft = repository?.createPlanVersionDraft?.bind(repository);
            const publish = repository?.publishPlanVersionDraft?.bind(repository);
            const byId = repository?.findVersionById?.bind(repository);
            if (!repository || !createDraft || !publish || !byId) {
                missing(t, 'planDraftPublish');
                return;
            }
            await repository.create({ planKey: 'PLAN_CLAIM', label: 'Claim' });
            const first = await createDraft(planDraft('PLAN_CLAIM', '2026-01-01'));
            await publish(first.id, publishedOn('2026-01-01', 'first-operator'));
            const second = await createDraft({
                ...planDraft('PLAN_CLAIM', '2026-03-01'),
                baseVersionId: first.id,
            });
            const winner = await publish(second.id, publishedOn('2026-03-01', 'winner'));
            const closed = await byId(first.id);

            // The losing request, arriving with another operator and date.
            await assert.rejects(
                () => publish(second.id, publishedOn('2026-06-01', 'loser')),
                refusedAs(CATALOG_ERROR_CODES.PLAN_VERSION_ALREADY_PUBLISHED),
            );

            const successor = await byId(second.id);
            assert.equal(successor?.publishedByUserId, 'winner', 'who published it still stands');
            assert.equal(successor?.publishedAt, winner.publishedAt, 'and when');
            assert.equal(
                (await byId(first.id))?.supersededAt,
                closed?.supersededAt,
                'the predecessor is closed once',
            );
        });

        test('two publications of one plan draft at once: one wins, the other is refused', async (t) => {
            // A double click. Both requests pass the service's check before
            // either writes, so only the adapter's claim decides.
            const repository = harness.adapter.planRepository;
            const createDraft = repository?.createPlanVersionDraft?.bind(repository);
            const publish = repository?.publishPlanVersionDraft?.bind(repository);
            const byId = repository?.findVersionById?.bind(repository);
            if (!repository || !createDraft || !publish || !byId) {
                missing(t, 'planDraftPublish');
                return;
            }
            await repository.create({ planKey: 'PLAN_TWICE', label: 'Twice' });
            const draft = await createDraft(planDraft('PLAN_TWICE', '2026-01-01'));

            const outcomes = await Promise.allSettled([
                publish(draft.id, publishedOn('2026-01-01', 'first')),
                publish(draft.id, publishedOn('2026-01-01', 'second')),
            ]);

            const won = outcomes.filter((outcome) => outcome.status === 'fulfilled');
            const lost = outcomes.filter((outcome) => outcome.status === 'rejected');
            assert.equal(won.length, 1, 'exactly one publication wins');
            assert.equal(lost.length, 1, 'and the other is refused');
            refusedAs(CATALOG_ERROR_CODES.PLAN_VERSION_ALREADY_PUBLISHED)(lost[0]?.reason);
            assert.equal(
                (await byId(draft.id))?.publishedByUserId,
                won[0]?.value.publishedByUserId,
                "the stored version is the winner's",
            );
        });

        test('discarding a plan draft cannot remove a version published meanwhile', async (t) => {
            // The order the race produces: the caller decided to discard a
            // draft, and somebody published it before the discard arrived.
            const repository = harness.adapter.planRepository;
            const createDraft = repository?.createPlanVersionDraft?.bind(repository);
            const publish = repository?.publishPlanVersionDraft?.bind(repository);
            const byId = repository?.findVersionById?.bind(repository);
            const discard = repository?.deletePlanVersionDraft?.bind(repository);
            if (!repository || !createDraft || !publish || !byId || !discard) {
                missing(t, 'planDraftDiscard');
                return;
            }
            await repository.create({ planKey: 'PLAN_RACE', label: 'Race' });
            const draft = await createDraft(planDraft('PLAN_RACE', '2026-01-01'));
            await publish(draft.id, publishedOn('2026-01-01', null));

            await assert.rejects(
                () => discard(draft.id),
                refusedAs(CATALOG_ERROR_CODES.PLAN_VERSION_ALREADY_PUBLISHED),
            );
            assert.ok(await byId(draft.id), 'and it is still there afterwards');

            // A draft that is already gone is what the caller wanted.
            await discard(NO_SUCH_VERSION);
        });

        test('publishing a plan version that is not there is refused as gone', async (t) => {
            const repository = harness.adapter.planRepository;
            const publish = repository?.publishPlanVersionDraft?.bind(repository);
            if (!repository || !publish) {
                missing(t, 'planDraftPublish');
                return;
            }
            await assert.rejects(
                () => publish(NO_SUCH_VERSION, publishedOn('2026-01-01', null)),
                refusedAs(CATALOG_ERROR_CODES.PLAN_VERSION_NOT_FOUND),
            );
        });

        test('a plan key names one plan for the whole installation', async (t) => {
            // The uniqueness the schema promises, exercised where it is
            // actually enforced. It used to be scoped to a project, so a second
            // plan under the same key was legal as long as the projects
            // differed — and `plan_versions.planId` holds the key alone, which
            // meant two plans could share one version lineage. The plan key is
            // now the whole identity, and this is the scenario that says so:
            // the second `create` is refused, whatever it is called.
            const repository = harness.adapter.planRepository;
            if (!repository) {
                missing(t, 'planRepository');
                return;
            }
            await repository.create({ planKey: 'DOUBLE', label: 'First' });
            await assert.rejects(
                () => repository.create({ planKey: 'DOUBLE', label: 'Second' }),
                refusedAs(CATALOG_ERROR_CODES.PLAN_ALREADY_EXISTS, { planKey: 'DOUBLE' }),
            );
        });

        test('a bundle key names one bundle for the whole installation', async (t) => {
            const catalog = harness.adapter.bundleRepository;
            if (!catalog) {
                missing(t, 'bundleRepository');
                return;
            }
            await catalog.create({ bundleKey: 'DOUBLE', label: 'First' });
            await assert.rejects(
                () => catalog.create({ bundleKey: 'DOUBLE', label: 'Second' }),
                refusedAs(CATALOG_ERROR_CODES.BUNDLE_ALREADY_EXISTS, { bundleKey: 'DOUBLE' }),
            );
        });

        test('a plan has one draft at a time, and a second is refused naming the first', async (t) => {
            const repository = harness.adapter.planRepository;
            const createDraft = repository?.createPlanVersionDraft?.bind(repository);
            if (!repository || !createDraft) {
                missing(t, 'planDraftPublish');
                return;
            }
            await repository.create({ planKey: 'ONE-DRAFT', label: 'One draft' });
            const draft = {
                planId: 'ONE-DRAFT',
                features: ['CORE'],
                quotas: {},
                monthlyNet: '10.00',
                yearlyNet: '100.00',
            };
            const first = await createDraft(draft);
            await assert.rejects(
                () => createDraft(draft),
                refusedAs(CATALOG_ERROR_CODES.PLAN_DRAFT_ALREADY_EXISTS, {
                    planKey: 'ONE-DRAFT',
                    draftVersion: first.version,
                }),
            );
        });

        test('two drafts of one bundle asked for at once: one is created, the other refused', async (t) => {
            // Both requests can read "no draft" before either writes, so what
            // decides is the store's one-draft index, not the read before it.
            const catalog = harness.adapter.bundleRepository;
            if (!catalog?.publishDraft) {
                missing(t, 'bundleDraftPublish');
                return;
            }
            const bundle = await catalog.create({ bundleKey: 'TWO-AT-ONCE', label: 'Two at once' });
            const draft = { bundleId: bundle.id, features: ['REPORTS'], quotas: {} };
            const outcomes = await Promise.allSettled([
                catalog.createDraft(draft),
                catalog.createDraft(draft),
            ]);
            const created = outcomes.filter((outcome) => outcome.status === 'fulfilled');
            const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
            assert.equal(created.length, 1, 'exactly one draft is created');
            assert.equal(refused.length, 1, 'the other is refused');
            refusedAs(CATALOG_ERROR_CODES.BUNDLE_DRAFT_ALREADY_EXISTS, {
                bundleKey: 'TWO-AT-ONCE',
                draftVersion: (created[0] as PromiseFulfilledResult<{ version: number }>).value
                    .version,
            })((refused[0] as PromiseRejectedResult).reason);
        });

        test('a bundle has one draft at a time, and a second is refused naming the first', async (t) => {
            const catalog = harness.adapter.bundleRepository;
            if (!catalog?.publishDraft) {
                missing(t, 'bundleDraftPublish');
                return;
            }
            const bundle = await catalog.create({ bundleKey: 'ONE-DRAFT', label: 'One draft' });
            const draft = { bundleId: bundle.id, features: ['REPORTS'], quotas: {} };
            const first = await catalog.createDraft(draft);
            await assert.rejects(
                () => catalog.createDraft(draft),
                refusedAs(CATALOG_ERROR_CODES.BUNDLE_DRAFT_ALREADY_EXISTS, {
                    bundleKey: 'ONE-DRAFT',
                    draftVersion: first.version,
                }),
            );
        });

        test('a retired plan still occupies its key', async (t) => {
            // The same rule as for bundles, and for the same reason: the unique
            // index is unconditional, so a soft delete does not free the key.
            // `createPlan`'s duplicate check calls `findByKey`, and an adapter
            // that hides retired rows turns a 409 into a constraint violation.
            const repository = harness.adapter.planRepository;
            const retire = repository?.softDelete?.bind(repository);
            const byKey = repository?.findByKey?.bind(repository);
            if (!repository || !retire || !byKey) {
                missing(t, 'planRetirement');
                return;
            }
            const plan = await repository.create({ planKey: 'RETIRED_PLAN', label: 'Retired' });
            await retire(plan.id);

            const stillThere = await byKey('RETIRED_PLAN');
            assert.equal(stillThere?.id, plan.id, 'the key is not free again');
            assert.ok(stillThere?.deletedAt, 'and the row says it is retired');
            assert.equal(
                (await repository.list({})).some((row) => row.id === plan.id),
                false,
                'a retired plan is not in the catalogue an operator browses',
            );
        });

        test('a plan key no plan has finds no versions, rather than failing', async (t) => {
            // A plan can go between listing the catalogue and reading its
            // versions, so a read by a key no plan has answers empty. Adapters
            // without the editor's writes still have these reads, and the
            // bundle service asks them on every publish.
            const repository = harness.adapter.planRepository;
            if (
                !repository?.listVersions ||
                !repository.findCurrentDraft ||
                !repository.findLatestLivePlanVersion
            ) {
                missing(t, 'planVersionReads');
                return;
            }
            const entitlementVersions = harness.adapter.planVersionRepository;

            assert.deepEqual(await repository.listVersions('NO_SUCH_PLAN'), []);
            assert.equal(await repository.findCurrentDraft('NO_SUCH_PLAN'), null);
            assert.equal(await repository.findLatestLivePlanVersion('NO_SUCH_PLAN'), null);
            if (repository.findActivePlanVersion) {
                assert.equal(
                    await repository.findActivePlanVersion('NO_SUCH_PLAN', new Date()),
                    null,
                );
            }
            assert.equal(await entitlementVersions.findActive('NO_SUCH_PLAN', new Date()), null);
        });

        test('retiring a plan hides none of its versions', async (t) => {
            // A retired plan's row is there, and the guard deciding whether it
            // may be deleted counts its published versions — an adapter that
            // hid them would let that delete through.
            const repository = harness.adapter.planRepository;
            if (
                !repository?.createPlanVersionDraft ||
                !repository.publishPlanVersionDraft ||
                !repository.listVersions ||
                !repository.findCurrentDraft ||
                !repository.findLatestLivePlanVersion ||
                !repository.softDelete
            ) {
                missing(t, 'planVersionRetirement');
                return;
            }
            const whileOnSale = new Date('2026-03-01T00:00:00.000Z');
            const listVersions = repository.listVersions.bind(repository);
            const findCurrentDraft = repository.findCurrentDraft.bind(repository);
            const findLatestLive = repository.findLatestLivePlanVersion.bind(repository);
            const entitlementVersions = harness.adapter.planVersionRepository;

            const plan = await repository.create({ planKey: 'RETIRING', label: 'Retiring' });
            const firstDraft = await repository.createPlanVersionDraft({
                planId: 'RETIRING',
                features: ['CORE'],
                quotas: { users: 5 },
                monthlyNet: '10.00',
                yearlyNet: '100.00',
                validFrom: '2026-01-01',
            });
            const live = await repository.publishPlanVersionDraft(firstDraft.id, {
                publishedByUserId: null,
                publishedChanges: [],
                nonRegressive: true,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
                validUntil: null,
            });
            const openDraft = await repository.createPlanVersionDraft({
                planId: 'RETIRING',
                baseVersionId: live.id,
                features: ['CORE', 'PLUS'],
                quotas: { users: 10 },
                monthlyNet: '15.00',
                yearlyNet: '150.00',
                validFrom: '2026-06-01',
            });
            const reads = async () => ({
                versions: (await listVersions('RETIRING')).map((row) => row.id),
                draft: (await findCurrentDraft('RETIRING'))?.id ?? null,
                latestLive: (await findLatestLive('RETIRING'))?.id ?? null,
                entitlementFeatures:
                    (await entitlementVersions.findActive('RETIRING', whileOnSale))?.features ??
                    null,
            });
            const beforeRetiring = await reads();
            // The entitlement read goes through a slice an adapter may keep in a
            // table of its own, so it is compared before and after rather than
            // pinned to what the catalogue slice wrote.
            assert.deepEqual(
                {
                    versions: beforeRetiring.versions,
                    draft: beforeRetiring.draft,
                    latestLive: beforeRetiring.latestLive,
                },
                { versions: [live.id, openDraft.id], draft: openDraft.id, latestLive: live.id },
                'a live plan reads its versions, so the comparison below has a subject',
            );

            await repository.softDelete(plan.id);

            assert.deepEqual(await reads(), beforeRetiring, 'retiring the plan hid its versions');
        });

        test('a retired bundle still occupies its key', async (t) => {
            // `findByKey` answers the database's question, and
            // `bundles_bundleKey_key` is an unconditional unique
            // index: retiring a bundle does not free its key. Its one caller is
            // the duplicate check in `createBundle`, so an adapter that hides
            // retired rows lets that check pass and the insert then fail on the
            // constraint — a 500 where the service had `BUNDLE_ALREADY_EXISTS`
            // ready. `list` is the active-catalogue lookup, and it excludes
            // them.
            const catalog = harness.adapter.bundleRepository;
            const retire = catalog?.softDelete?.bind(catalog);
            const byKey = catalog?.findByKey?.bind(catalog);
            if (!catalog || !retire || !byKey) {
                missing(t, 'bundleRetirement');
                return;
            }
            const bundle = await catalog.create({
                bundleKey: 'RETIRED_KEY',
                label: 'Retired',
            });
            assert.equal((await byKey('RETIRED_KEY'))?.id, bundle.id);

            await retire(bundle.id);
            const stillThere = await byKey('RETIRED_KEY');
            assert.equal(stillThere?.id, bundle.id, 'the key is not free again');
            assert.ok(stillThere?.deletedAt, 'and the row says it is retired');

            // The active catalogue is the other question, and `list` answers it.
            const listed = await catalog.list({});
            assert.equal(
                listed.some((row) => row.id === bundle.id),
                false,
                'a retired bundle is not in the catalogue an operator browses',
            );
        });

        test('countByPlanVersionId counts the version bound and the one a scheduled change will bind', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.subscriptionRepository.countByPlanVersionId) {
                missing(t, 'countByPlanVersionId');
                return;
            }
            const v1 = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const v2 = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 2,
                quotas: {},
                features: [],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-current',
                plan: 'PRO',
                planVersionId: v2.planVersionId,
            });
            await seed.createSubscription({
                tenantId: 'tenant-scheduled',
                plan: 'PRO',
                planVersionId: v1.planVersionId,
                pendingChangeVersionId: v2.planVersionId,
            });

            assert.equal(
                await adapter.subscriptionRepository.countByPlanVersionId(v2.planVersionId),
                2,
            );
        });

        // -------------------------------------------------------------
        // Transactions + locking
        // -------------------------------------------------------------

        test('transaction rollback discards writes', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            if (!adapter.promoCodeRedemptionRepository) {
                missing(t, 'promoCodeRedemptions');
                return;
            }
            const redemptions = adapter.promoCodeRedemptionRepository;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });
            const { promoCodeId } = await seed.createPromoCode({
                code: 'ROLLBACK10',
                maxRedemptions: null,
            });

            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    await redemptions.create(
                        {
                            promoCodeId,
                            subscriptionId,
                            tenantId: 'tenant-a',
                            appliedValueType: 'PERCENT',
                            appliedValue: '10.00',
                            appliedDurationType: 'ONCE',
                            appliedDurationValue: null,
                            startsAt: new Date(),
                            endsAt: null,
                        },
                        tx,
                    );
                    throw new Error('boom — roll back');
                }),
            );

            assert.equal(
                await redemptions.findBySubscription(subscriptionId),
                null,
                'write must be rolled back',
            );
        });

        // @requirement SC-PROMO-001 — A code is redeemed at most once per subscription
        test('a redemption is reversed once, whichever of two reversals writes first', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.promoCodeRedemptionRepository) {
                missing(t, 'promoCodeRedemptions');
                return;
            }
            const redemptions = adapter.promoCodeRedemptionRepository;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-reversed-once',
                plan: 'STARTER',
                planVersionId,
            });
            const { promoCodeId } = await seed.createPromoCode({
                code: 'ONCE10',
                maxRedemptions: null,
            });
            const redemption = await redemptions.create({
                promoCodeId,
                subscriptionId,
                tenantId: 'tenant-reversed-once',
                appliedValueType: 'PERCENT',
                appliedValue: '10.00',
                appliedDurationType: 'ONCE',
                appliedDurationValue: null,
                startsAt: new Date('2026-01-01T00:00:00.000Z'),
                endsAt: new Date('2026-02-01T00:00:00.000Z'),
            });

            const both = await Promise.all([
                redemptions.setReversed(redemption.id),
                redemptions.setReversed(redemption.id),
            ]);

            assert.equal(
                both.filter((answer) => answer !== null).length,
                1,
                'both reversals claimed the redemption, and both would give its slot back',
            );
            assert.equal(both.find((answer) => answer !== null)?.status, 'REVERSED');
            assert.equal(
                (await redemptions.findBySubscription(subscriptionId))?.status,
                'REVERSED',
            );
            assert.equal(
                await redemptions.setReversed(redemption.id),
                null,
                'a third reversal of a reversed redemption claims nothing',
            );
        });

        test('findByTenantIdLocked serializes concurrent transactions on the same tenant', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no pessimistic-locking capability');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 1 },
                features: [],
                published: true,
            });
            await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });

            const sections: Array<{ enter: number; exit: number }> = [];
            const critical = (tx: TransactionContext) =>
                adapter.subscriptionRepository
                    .findByTenantIdLocked('tenant-a', tx)
                    .then(async () => {
                        const enter = Date.now();
                        await sleep(LOCK_HOLD_MS);
                        sections.push({ enter, exit: Date.now() });
                    });

            await Promise.all([
                adapter.transactionRunner.run(critical),
                adapter.transactionRunner.run(critical),
            ]);

            assert.equal(sections.length, 2);
            sections.sort((a, b) => a.enter - b.enter);
            assert.ok(
                sections[1].enter >= sections[0].exit,
                `critical sections overlap: [${sections[0].enter}, ${sections[0].exit}] vs ` +
                    `[${sections[1].enter}, ${sections[1].exit}] — row lock not effective`,
            );
        });

        // -------------------------------------------------------------
        // Promo codes — atomic availability
        // -------------------------------------------------------------

        test('concurrent claimSlot grants exactly maxRedemptions slots', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.promoCodeRepository) {
                missing(t, 'promoCodes');
                return;
            }
            const promoCodes = adapter.promoCodeRepository;
            const { promoCodeId } = await seed.createPromoCode({
                code: 'LAST-SLOT',
                maxRedemptions: 1,
            });

            const attempts = await Promise.all(
                Array.from({ length: 5 }, () =>
                    adapter.transactionRunner.run((tx) => promoCodes.claimSlot(promoCodeId, tx)),
                ),
            );

            assert.equal(attempts.filter(Boolean).length, 1, 'exactly one claim must win');
            const code = await promoCodes.findById(promoCodeId);
            assert.equal(code?.redemptionsCount, 1);
        });

        test('claimSlot / markExhaustedIfFull / releaseSlot lifecycle', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.promoCodeRepository) {
                missing(t, 'promoCodes');
                return;
            }
            const promoCodes = adapter.promoCodeRepository;
            const { promoCodeId } = await seed.createPromoCode({
                code: 'CYCLE',
                maxRedemptions: 1,
            });

            assert.equal(await promoCodes.claimSlot(promoCodeId), true);
            assert.equal(await promoCodes.claimSlot(promoCodeId), false, 'code is full');

            await promoCodes.markExhaustedIfFull(promoCodeId);
            assert.equal((await promoCodes.findById(promoCodeId))?.status, 'EXHAUSTED');

            await promoCodes.releaseSlot(promoCodeId);
            const released = await promoCodes.findById(promoCodeId);
            assert.equal(released?.status, 'ACTIVE');
            assert.equal(released?.redemptionsCount, 0);
        });

        // @requirement SC-PROMO-014 — A code is 4 to 32 characters of upper-case letters, digits, hyphen and underscore
        test('a search for a code finds the underscore it types, not any character there', async (t) => {
            // An underscore is part of a code, and in SQL's LIKE it stands for
            // any one character: searched for unescaped, BLACK_ finds BLACKX25.
            const { seed, adapter } = harness;
            if (!adapter.promoCodeRepository) {
                missing(t, 'promoCodes');
                return;
            }
            await seed.createPromoCode({ code: 'BLACK_25', maxRedemptions: null });
            await seed.createPromoCode({ code: 'BLACKX25', maxRedemptions: null });

            const found = await adapter.promoCodeRepository.findMany({ search: 'black_' });

            assert.deepEqual(
                found.map((code) => code.code),
                ['BLACK_25'],
            );
        });

        test("a promo code keeps the amounts it was given, to the column's rule", async (t) => {
            // `(2.675).toFixed(2)` is '2.67' and `(1.005).toFixed(2)` is '1.00':
            // rounding the binary double before the column sees it sends a value
            // one way or the other by its representation. The platform refuses
            // a third place at its boundary; here the adapter is asked for one
            // anyway, and the column's own rule — half away from zero — decides.
            const promoCodes = harness.adapter.promoCodeRepository;
            if (!promoCodes) {
                missing(t, 'promoCodes');
                return;
            }
            const created = await promoCodes.create({
                code: 'TO-THE-CENT',
                valueType: 'ABSOLUTE',
                value: 2.675,
                durationType: 'ONCE',
                minimumPlanAmountGross: 1.005,
                createdById: 'operator-1',
            });

            assert.equal(Number(created.value).toFixed(2), '2.68');
            assert.equal(Number(created.minimumPlanAmountGross).toFixed(2), '1.01');
        });

        test('a deleted code keeps its name', async (t) => {
            // Contract snapshots and redemption records name a code by its
            // text, so a second "SPRING-25" could not be told from the first.
            // The name stays taken; the platform's duplicate check has to see
            // the deleted code to say so, and the unique index says it when
            // that check is passed.
            const promoCodes = harness.adapter.promoCodeRepository;
            if (!promoCodes) {
                missing(t, 'promoCodes');
                return;
            }
            const first = await promoCodes.create({
                code: 'KEPT-NAME',
                valueType: 'PERCENT',
                value: 10,
                durationType: 'ONCE',
                createdById: 'operator-1',
            });
            await promoCodes.softDelete(first.id);

            const found = await promoCodes.findByCode('KEPT-NAME');
            assert.equal(found?.id, first.id, 'found by its name after it was deleted');
            assert.ok(found?.deletedAt, 'and saying it is deleted');
            await assert.rejects(
                () =>
                    promoCodes.create({
                        code: 'KEPT-NAME',
                        valueType: 'PERCENT',
                        value: 20,
                        durationType: 'ONCE',
                        createdById: 'operator-2',
                    }),
                refusedAs(PROMO_ERROR_CODES.PROMO_CODE_ALREADY_EXISTS),
            );
        });

        test('two creates of one name at once: one is created, the other is refused', async (t) => {
            const promoCodes = harness.adapter.promoCodeRepository;
            if (!promoCodes) {
                missing(t, 'promoCodes');
                return;
            }
            const create = (createdById: string) =>
                promoCodes.create({
                    code: 'RACED-NAME',
                    valueType: 'PERCENT',
                    value: 10,
                    durationType: 'ONCE',
                    createdById,
                });

            const outcomes = await Promise.allSettled([create('first'), create('second')]);

            assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
            const lost = outcomes.find((o) => o.status === 'rejected');
            refusedAs(PROMO_ERROR_CODES.PROMO_CODE_ALREADY_EXISTS)(lost?.reason);
        });

        test('the expiry leaves a deleted code as it was', async (t) => {
            const promoCodes = harness.adapter.promoCodeRepository;
            if (!promoCodes) {
                missing(t, 'promoCodes');
                return;
            }
            const lapsed = (code: string) =>
                promoCodes.create({
                    code,
                    valueType: 'PERCENT',
                    value: 10,
                    durationType: 'ONCE',
                    validUntil: new Date('2026-01-31T00:00:00.000Z'),
                    createdById: 'operator-1',
                });
            const live = await lapsed('LAPSED-LIVE');
            const deleted = await lapsed('LAPSED-DELETED');
            await promoCodes.softDelete(deleted.id);

            const expired = await promoCodes.expireDueCodes(new Date('2026-02-15T00:00:00.000Z'));

            assert.equal(expired, 1, 'the live code only');
            assert.equal((await promoCodes.findById(live.id))?.status, 'EXPIRED');
            assert.equal(
                (await promoCodes.findById(deleted.id))?.status,
                'ACTIVE',
                'a row the operator removed is not written to',
            );
        });

        test('an update writes every field it names, and leaves the others', async (t) => {
            // An operator's edit that an adapter drops arrives nowhere and
            // reports success: the list shows the old discount, and every
            // invoice the code touches is priced with it.
            const promoCodes = harness.adapter.promoCodeRepository;
            if (!promoCodes) {
                missing(t, 'promoCodes');
                return;
            }
            const created = await promoCodes.create({
                code: 'EDITED',
                valueType: 'PERCENT',
                value: 10,
                durationType: 'ONCE',
                description: 'kept',
                createdById: 'operator-1',
            });
            const changes = {
                status: 'PAUSED',
                valueType: 'ABSOLUTE',
                value: 19.99,
                durationType: 'MONTHS',
                durationValue: 3,
                validFrom: new Date('2026-02-01T00:00:00.000Z'),
                validUntil: new Date('2026-12-31T00:00:00.000Z'),
                maxRedemptions: 50,
                appliesToPlans: ['PRO'],
                appliesToBilling: 'YEARLY',
                firstTimeCustomersOnly: false,
                minimumPlanAmountGross: 49.9,
                allowZeroInvoice: true,
                campaignTag: 'SPRING',
                revenueDeductionAccount: '8736',
            } as const;

            await promoCodes.update(created.id, { ...changes, appliesToPlans: ['PRO'] });
            const stored = await promoCodes.findById(created.id);

            assert.ok(stored, 'the code is still there');
            assert.deepEqual(
                {
                    status: stored.status,
                    valueType: stored.valueType,
                    value: Number(stored.value).toFixed(2),
                    durationType: stored.durationType,
                    durationValue: stored.durationValue,
                    validFrom: stored.validFrom?.toISOString(),
                    validUntil: stored.validUntil?.toISOString(),
                    maxRedemptions: stored.maxRedemptions,
                    appliesToPlans: stored.appliesToPlans,
                    appliesToBilling: stored.appliesToBilling,
                    firstTimeCustomersOnly: stored.firstTimeCustomersOnly,
                    minimumPlanAmountGross: Number(stored.minimumPlanAmountGross).toFixed(2),
                    allowZeroInvoice: stored.allowZeroInvoice,
                    campaignTag: stored.campaignTag,
                    revenueDeductionAccount: stored.revenueDeductionAccount,
                },
                {
                    ...changes,
                    value: '19.99',
                    validFrom: '2026-02-01T00:00:00.000Z',
                    validUntil: '2026-12-31T00:00:00.000Z',
                    appliesToPlans: ['PRO'],
                    minimumPlanAmountGross: '49.90',
                },
            );
            assert.equal(stored.description, 'kept', 'a field the update did not name stays');

            await promoCodes.update(created.id, { minimumPlanAmountGross: null });
            assert.equal(
                (await promoCodes.findById(created.id))?.minimumPlanAmountGross,
                null,
                'and a field it clears is cleared',
            );
        });

        // -------------------------------------------------------------
        // Promo codes — a slot held for a checkout
        // -------------------------------------------------------------

        /** The hold repository and a code with `maxRedemptions` slots, or `null` after `missing`. */
        async function holdScenario(
            t: TestContext,
            maxRedemptions: number | null,
            status = 'ACTIVE',
        ) {
            const { seed, adapter } = harness;
            const holds = adapter.promoCodeHoldRepository;
            const promoCodes = adapter.promoCodeRepository;
            if (!holds || !promoCodes) {
                missing(t, 'promoCodeHolds');
                return null;
            }
            const { promoCodeId } = await seed.createPromoCode({
                code: 'HELD-FOR-CHECKOUT',
                maxRedemptions,
                status,
            });
            const counts = async () => {
                const code = await promoCodes.findById(promoCodeId);
                return { held: code?.heldCount, redeemed: code?.redemptionsCount };
            };
            return { holds, promoCodes, promoCodeId, counts };
        }

        test('a held slot is not given to a second checkout, nor to a redemption', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodes, promoCodeId, counts } = scenario;

            const first = await holds.take({
                promoCodeId,
                checkoutOfferId: 'offer-1',
                expiresAt: inDays(30),
            });
            assert.equal(first.outcome, 'taken');
            const second = await holds.take({
                promoCodeId,
                checkoutOfferId: 'offer-2',
                expiresAt: inDays(30),
            });
            assert.equal(second.outcome, 'no-slot');
            assert.equal(await promoCodes.claimSlot(promoCodeId), false, 'the held slot is taken');
            assert.deepEqual(await counts(), { held: 1, redeemed: 0 });

            await promoCodes.markExhaustedIfFull(promoCodeId);
            assert.equal(
                (await promoCodes.findById(promoCodeId))?.status,
                'ACTIVE',
                'a code full only of holds is not exhausted: the holds may still end',
            );
        });

        test('checkouts racing for the last slots get exactly as many holds as there are slots', async (t) => {
            const scenario = await holdScenario(t, 2);
            if (!scenario) return;
            const { holds, promoCodeId, counts } = scenario;

            const outcomes = await Promise.all(
                Array.from({ length: 6 }, (_, index) =>
                    holds.take({
                        promoCodeId,
                        checkoutOfferId: `offer-${index}`,
                        expiresAt: inDays(30),
                    }),
                ),
            );

            assert.equal(outcomes.filter((taken) => taken.outcome === 'taken').length, 2);
            assert.deepEqual(await counts(), { held: 2, redeemed: 0 });
        });

        test('one checkout started twice at once holds one slot', async (t) => {
            const scenario = await holdScenario(t, null);
            if (!scenario) return;
            const { holds, promoCodeId, counts } = scenario;

            const outcomes = await Promise.all(
                Array.from({ length: 4 }, () =>
                    holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(30) }),
                ),
            );

            assert.deepEqual(outcomes.map((taken) => taken.outcome).sort(), [
                'offer-holds-one',
                'offer-holds-one',
                'offer-holds-one',
                'taken',
            ]);
            assert.deepEqual(await counts(), { held: 1, redeemed: 0 });
        });

        test('a paused or deleted code gives no slot to hold', async (t) => {
            const scenario = await holdScenario(t, null, 'PAUSED');
            if (!scenario) return;
            const { holds, promoCodes, promoCodeId, counts } = scenario;
            const hold = { promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(30) };

            assert.equal((await holds.take(hold)).outcome, 'no-slot');
            await promoCodes.update(promoCodeId, { status: 'ACTIVE' });
            await promoCodes.softDelete(promoCodeId);
            assert.equal((await holds.take(hold)).outcome, 'no-slot');
            assert.deepEqual(await counts(), { held: 0, redeemed: 0 });
        });

        test('a released hold gives its slot back once', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodes, promoCodeId, counts } = scenario;
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(30) });

            assert.equal(await holds.release('offer-1'), true);
            assert.equal(await holds.release('offer-1'), false, 'nothing is left to release');
            assert.equal(await holds.findByCheckoutOffer('offer-1'), null);
            assert.deepEqual(await counts(), { held: 0, redeemed: 0 });
            assert.equal(await promoCodes.claimSlot(promoCodeId), true, 'the slot is free again');
        });

        test('an expired hold gives its slot back, and a live one keeps it', async (t) => {
            const scenario = await holdScenario(t, 2);
            if (!scenario) return;
            const { holds, promoCodes, promoCodeId, counts } = scenario;
            const { promoCodeId: otherCodeId } = await harness.seed.createPromoCode({
                code: 'OTHER-CODE',
                maxRedemptions: 1,
            });
            const now = new Date();
            await holds.take({ promoCodeId, checkoutOfferId: 'expired', expiresAt: inDays(-1) });
            await holds.take({ promoCodeId, checkoutOfferId: 'live', expiresAt: inDays(1) });
            await holds.take({
                promoCodeId: otherCodeId,
                checkoutOfferId: 'other',
                expiresAt: inDays(-1),
            });

            assert.equal(await holds.expireDue(now, promoCodeId), 1, 'only the code asked for');
            assert.equal(await holds.findByCheckoutOffer('expired'), null);
            assert.notEqual(await holds.findByCheckoutOffer('live'), null);
            assert.deepEqual(await counts(), { held: 1, redeemed: 0 });

            assert.equal(await holds.expireDue(now), 1, 'every code when none is named');
            assert.equal(await holds.findByCheckoutOffer('other'), null);
            assert.equal((await promoCodes.findById(otherCodeId))?.heldCount, 0);
        });

        test('an extended hold outlives its first expiry', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodeId, counts } = scenario;
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(1) });

            assert.equal(await holds.extend('offer-1', promoCodeId, inDays(30)), true);
            assert.equal(await holds.extend('offer-1', 'another-code', inDays(30)), false);
            assert.equal(await holds.expireDue(inDays(2)), 0);
            assert.deepEqual(await counts(), { held: 1, redeemed: 0 });
        });

        test('a hold is never moved earlier, whichever of two starts writes last', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodeId } = scenario;
            const expiryOf = async () =>
                (await holds.findByCheckoutOffer('offer-1'))?.expiresAt.getTime();
            const form = inDays(4);
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: form });

            assert.equal(await holds.extend('offer-1', promoCodeId, inDays(1)), true);
            assert.equal(await expiryOf(), form.getTime(), 'a start asking for less');

            const later = inDays(5);
            await Promise.all([
                holds.extend('offer-1', promoCodeId, later),
                holds.extend('offer-1', promoCodeId, inDays(2)),
            ]);
            assert.equal(await expiryOf(), later.getTime(), 'two starts at once');
        });

        test('a hold is given back as written only while nobody moved it since', async (t) => {
            const scenario = await holdScenario(t, 2);
            if (!scenario) return;
            const { holds, promoCodeId, counts } = scenario;
            const moved = inDays(1);
            const unmoved = inDays(1);
            await holds.take({ promoCodeId, checkoutOfferId: 'moved', expiresAt: moved });
            await holds.take({ promoCodeId, checkoutOfferId: 'unmoved', expiresAt: unmoved });
            await holds.extend('moved', promoCodeId, inDays(4));

            assert.equal(await holds.releaseIfUnmoved('moved', moved), false);
            assert.notEqual(await holds.findByCheckoutOffer('moved'), null);
            assert.equal(await holds.releaseIfUnmoved('unmoved', unmoved), true);
            assert.equal(await holds.findByCheckoutOffer('unmoved'), null);
            assert.deepEqual(await counts(), { held: 1, redeemed: 0 });
        });

        test('a hold handed over on a transaction becomes the slot of the redemption on it', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodeId, counts } = scenario;
            const { transactionRunner } = harness.adapter;
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(30) });

            const converted = await transactionRunner.run(async (tx) => {
                assert.equal(await holds.handOver('offer-1', new Date(), tx), true);
                assert.equal(
                    await holds.expireDue(inDays(60), promoCodeId, tx),
                    0,
                    'a sweep leaves a handed-over hold to the conclusion it was handed to',
                );
                const elsewhere = await transactionRunner.run((other) =>
                    holds.convertHandedOver(promoCodeId, other),
                );
                assert.equal(elsewhere, false, 'no other transaction can convert it');
                return holds.convertHandedOver(promoCodeId, tx);
            });

            assert.equal(converted, true);
            assert.equal(await holds.findByCheckoutOffer('offer-1'), null);
            assert.deepEqual(await counts(), { held: 0, redeemed: 1 });
        });

        test('a hand-over rolled back with its transaction leaves the hold as it was', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodeId, counts } = scenario;
            const { transactionRunner } = harness.adapter;
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(30) });

            await assert.rejects(
                transactionRunner.run(async (tx) => {
                    await holds.handOver('offer-1', new Date(), tx);
                    await holds.convertHandedOver(promoCodeId, tx);
                    throw new Error('the conclusion failed');
                }),
                /the conclusion failed/,
            );

            assert.deepEqual(await counts(), { held: 1, redeemed: 0 });
            const again = await transactionRunner.run(async (tx) => {
                assert.equal(await holds.handOver('offer-1', new Date(), tx), true);
                return holds.convertHandedOver(promoCodeId, tx);
            });
            assert.equal(again, true, 'the retry hands it over again');
        });

        test('a mark left by a transaction that committed binds no later one', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodeId, counts } = scenario;
            const { transactionRunner } = harness.adapter;
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(30) });

            await transactionRunner.run((tx) => holds.handOver('offer-1', new Date(), tx));
            const later = await transactionRunner.run((tx) =>
                holds.convertHandedOver(promoCodeId, tx),
            );
            assert.equal(later, false, 'a redemption elsewhere does not take it as its slot');
            assert.deepEqual(await counts(), { held: 1, redeemed: 0 });

            assert.equal(await holds.expireDue(inDays(60)), 1, 'and it still expires');
            assert.deepEqual(await counts(), { held: 0, redeemed: 0 });
        });

        test('an expired hold is not handed over', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodeId } = scenario;
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(1) });

            const handedOver = await harness.adapter.transactionRunner.run((tx) =>
                holds.handOver('offer-1', inDays(2), tx),
            );

            assert.equal(handedOver, false);
        });

        test('a hold converts whatever the status of its code became', async (t) => {
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodes, promoCodeId, counts } = scenario;
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(30) });
            await promoCodes.update(promoCodeId, { status: 'PAUSED' });

            const converted = await harness.adapter.transactionRunner.run(async (tx) => {
                await holds.handOver('offer-1', new Date(), tx);
                return holds.convertHandedOver(promoCodeId, tx);
            });

            assert.equal(converted, true);
            assert.deepEqual(await counts(), { held: 0, redeemed: 1 });
        });

        test('a conversion and a release racing for one hold count it once', async (t) => {
            if (!harness.adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no pessimistic-locking capability');
                return;
            }
            const scenario = await holdScenario(t, 1);
            if (!scenario) return;
            const { holds, promoCodeId, counts } = scenario;
            const { transactionRunner } = harness.adapter;
            await holds.take({ promoCodeId, checkoutOfferId: 'offer-1', expiresAt: inDays(30) });

            let released: Promise<boolean> | undefined;
            const converted = await transactionRunner.run(async (tx) => {
                await holds.handOver('offer-1', new Date(), tx);
                // Started while the hand-over holds the row, so it waits for the
                // conversion to commit and then finds nothing left to release.
                released = holds.release('offer-1');
                await sleep(LOCK_HOLD_MS);
                return holds.convertHandedOver(promoCodeId, tx);
            });

            assert.equal(converted, true);
            assert.equal(await released, false);
            assert.deepEqual(await counts(), { held: 0, redeemed: 1 });
        });

        test('a subscription cannot redeem twice (unique guard)', async (t) => {
            const { seed, adapter } = harness;
            if (!adapter.promoCodeRedemptionRepository) {
                missing(t, 'promoCodeRedemptions');
                return;
            }
            const redemptions = adapter.promoCodeRedemptionRepository;
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });
            const { promoCodeId } = await seed.createPromoCode({
                code: 'ONCE-ONLY',
                maxRedemptions: null,
            });
            const redemption = {
                promoCodeId,
                subscriptionId,
                tenantId: 'tenant-a',
                appliedValueType: 'PERCENT' as const,
                appliedValue: '10.00',
                appliedDurationType: 'ONCE' as const,
                appliedDurationValue: null,
                startsAt: new Date(),
                endsAt: null,
            };

            await redemptions.create(redemption);
            await assert.rejects(
                redemptions.create(redemption),
                'second redemption for the same subscription must fail',
            );
        });

        // -------------------------------------------------------------
        // Audit + MFA
        // -------------------------------------------------------------

        test('audit write → query roundtrip with actorTag filters', async (t) => {
            const { adapter } = harness;
            if (!adapter.audit || !adapter.auditQuery) {
                missing(t, 'audit');
                return;
            }
            await adapter.audit.write({
                actor: {
                    userId: 'admin-1',
                    email: 'ops@example.com',
                    source: 'cli',
                    context: 'host1',
                },
                entity: 'Tenant',
                entityId: 'tenant-a',
                action: 'TENANT_SUSPEND',
                changes: { reason: 'test' },
            });
            await adapter.audit.write({
                actor: {
                    userId: 'admin-2',
                    email: 'web@example.com',
                    source: 'web',
                    context: 'sess9',
                },
                entity: 'PromoCode',
                entityId: 'promo-1',
                action: 'PROMO_CODE_CREATE',
            });

            const all = await adapter.auditQuery.list({});
            assert.equal(all.length, 2);

            const byAction = await adapter.auditQuery.list({ action: 'TENANT_SUSPEND' });
            assert.equal(byAction.length, 1);
            assert.equal(byAction[0].entityId, 'tenant-a');
            assert.equal(byAction[0].actorTag, 'cli:ops@example.com:host1');
            assert.equal(byAction[0].userId, 'admin-1');

            const cliOnly = await adapter.auditQuery.list({ actorTag: 'cli:*' });
            assert.equal(cliOnly.length, 1);
            assert.equal(cliOnly[0].action, 'TENANT_SUSPEND');
        });

        // @requirement SC-AUD-018
        test('an actor pattern finds a person whatever they acted through, and ignores case', async (t) => {
            const { adapter } = harness;
            if (!adapter.audit || !adapter.auditQuery) {
                missing(t, 'audit');
                return;
            }
            const write = (email: string, source: 'cli' | 'web', context: string) =>
                adapter.audit!.write({
                    actor: { userId: 'admin-1', email, source, context },
                    entity: 'Tenant',
                    entityId: 'tenant-a',
                    action: 'TENANT_SUSPEND',
                });
            await write('ops@example.com', 'cli', 'host1');
            await write('ops@example.com', 'web', 'sess1');
            await write('someone@example.com', 'cli', 'host1');

            const tagsFor = async (actorTag: string) =>
                (await adapter.auditQuery!.list({ actorTag }))
                    .map((entry) => entry.actorTag)
                    .sort();

            assert.deepEqual(await tagsFor('*:ops@example.com:*'), [
                'cli:ops@example.com:host1',
                'web:ops@example.com:sess1',
            ]);
            assert.deepEqual(await tagsFor('*:OPS@EXAMPLE.COM:*'), [
                'cli:ops@example.com:host1',
                'web:ops@example.com:sess1',
            ]);
            assert.deepEqual(await tagsFor('*:host1'), [
                'cli:ops@example.com:host1',
                'cli:someone@example.com:host1',
            ]);
            assert.deepEqual(
                await tagsFor('ops@example.com'),
                [],
                'a value with no star is a whole tag, and an e-mail alone is not one',
            );
            assert.deepEqual(await tagsFor('*:ops_example.com:*'), [], 'an underscore is literal');
        });

        test('MFA secret roundtrip', async (t) => {
            const { adapter } = harness;
            if (!adapter.mfa) {
                missing(t, 'mfa');
                return;
            }
            assert.equal(await adapter.mfa.getSecret('admin-1'), null);
            assert.equal(await adapter.mfa.isEnabled('admin-1'), false);

            await adapter.mfa.setSecret('admin-1', 'JBSWY3DPEHPK3PXP');
            assert.equal(await adapter.mfa.getSecret('admin-1'), 'JBSWY3DPEHPK3PXP');
            assert.equal(await adapter.mfa.isEnabled('admin-1'), true);

            await adapter.mfa.setSecret('admin-1', null);
            assert.equal(await adapter.mfa.getSecret('admin-1'), null);
            assert.equal(await adapter.mfa.isEnabled('admin-1'), false);
        });

        // -------------------------------------------------------------
        // Promo subscription lookup
        // -------------------------------------------------------------
        //
        // The read a promo code is validated against. It answers by
        // subscription id rather than by tenant, which is what makes returning
        // the wrong row possible — and a wrong row here decides that a discount
        // applies to a subscription it was not meant for.
        //
        // The scenarios below are written against that: several subscriptions
        // exist in every one of them, because an adapter that ignores its
        // predicate is correct for a table with a single row.

        test('finds the subscription the id names, not merely a subscription', async (t) => {
            const { adapter, seed } = harness;
            if (!adapter.promoSubscriptionLookup) {
                missing(t, 'promoSubscriptionLookup');
                return;
            }
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: { users: 5 },
                features: ['CORE'],
                published: true,
            });
            const first = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });
            const second = await seed.createSubscription({
                tenantId: 'tenant-b',
                plan: 'STARTER',
                planVersionId,
            });

            const found = await adapter.promoSubscriptionLookup.findById(second.subscriptionId);
            assert.ok(found, 'the lookup found nothing for an id that exists');
            assert.equal(found.id, second.subscriptionId);
            assert.equal(found.tenantId, 'tenant-b', 'it returned another tenant’s subscription');
            assert.notEqual(found.id, first.subscriptionId);
        });

        test('returns null for an id that does not exist', async (t) => {
            const { adapter, seed } = harness;
            if (!adapter.promoSubscriptionLookup) {
                missing(t, 'promoSubscriptionLookup');
                return;
            }
            // With a row present, so that "returns null" cannot be satisfied by
            // an empty table.
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            await seed.createSubscription({ tenantId: 'tenant-a', plan: 'STARTER', planVersionId });

            assert.equal(
                await adapter.promoSubscriptionLookup.findById(
                    '00000000-0000-4000-8000-000000000000',
                ),
                null,
            );
        });

        test('carries the fields a promo rule reads: cycle and start date', async (t) => {
            const { adapter, seed } = harness;
            if (!adapter.promoSubscriptionLookup) {
                missing(t, 'promoSubscriptionLookup');
                return;
            }
            // A promo code may be restricted to a billing cycle, or to
            // subscriptions started before a date. Both come from here, so both
            // have to survive the round trip — a null `startedAt` is a real
            // state and must not arrive as a date.
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'PRO',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const startedAt = new Date('2026-03-04T05:06:07.000Z');
            const dated = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'PRO',
                planVersionId,
                billingCycle: 'MONTHLY',
                startedAt,
            });
            const undated = await seed.createSubscription({
                tenantId: 'tenant-b',
                plan: 'PRO',
                planVersionId,
            });

            const withDate = await adapter.promoSubscriptionLookup.findById(dated.subscriptionId);
            assert.equal(withDate?.plan, 'PRO');
            assert.equal(withDate?.billingCycle, 'MONTHLY');
            assert.equal(withDate?.startedAt?.toISOString(), startedAt.toISOString());

            const withoutDate = await adapter.promoSubscriptionLookup.findById(
                undated.subscriptionId,
            );
            assert.equal(withoutDate?.startedAt, null, 'an unset start date came back as a date');
        });

        test('reads inside a transaction, so validation and redemption agree', async (t) => {
            const { adapter, seed } = harness;
            if (!adapter.promoSubscriptionLookup) {
                missing(t, 'promoSubscriptionLookup');
                return;
            }
            // Redeeming a code validates and writes in one transaction. A
            // lookup that ignored the handed-in context would read outside it
            // and could answer from a state the transaction has already moved
            // past.
            const { planVersionId } = await seed.createPlanVersion({
                planKey: 'STARTER',
                version: 1,
                quotas: {},
                features: [],
                published: true,
            });
            const { subscriptionId } = await seed.createSubscription({
                tenantId: 'tenant-a',
                plan: 'STARTER',
                planVersionId,
            });

            const seen = await adapter.transactionRunner.run(async (tx) =>
                adapter.promoSubscriptionLookup!.findById(subscriptionId, tx),
            );
            assert.equal(seen?.id, subscriptionId);
            assert.equal(seen?.tenantId, 'tenant-a');
        });

        // -------------------------------------------------------------
        test('an entitlement snapshot keeps the add-ons it names as left out', async (t) => {
            // A contract written while an add-on's cancellation is declared
            // leaves the add-on out of its entitlements and names it, and the
            // entitlement service reads that name to let the booking grant the
            // add-on until its date. A store that kept only the snapshot's
            // known fields would drop the name, and the add-on would be granted
            // by nobody before its date.
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const tenantId = 'tenant-contract-left-out';
            const signedAt = new Date('2026-05-10T00:00:00.000Z');
            const { subscriberId } = await createSubscriber({ legalName: 'Archiv GmbH' });
            const entitlementSnapshot = {
                plan: 'STANDARD',
                features: ['CORE'],
                quotas: { storageGb: 5 },
                leftOutBundleVersionIds: ['bundle-version-archive'],
            };
            const created = await contracts.create({
                tenantId,
                parties: partiesWith(subscriberId, 'Archiv GmbH'),
                effectiveFrom: signedAt,
                priceSnapshot: {
                    currency: 'EUR',
                    billingCycle: 'monthly',
                    subtotalNet: 29.9,
                    discountNet: 0,
                    totalNet: 29.9,
                    vatRate: 19,
                    totalGross: 35.58,
                },
                entitlementSnapshot,
                originalBundleVersionIds: ['bundle-version-archive'],
                lineItems: [
                    {
                        kind: 'plan',
                        sourceKey: 'STANDARD',
                        sourceVersionId: 'plan-version-1',
                        titleSnapshot: 'Standard',
                        descriptionSnapshot: null,
                        quantity: 1,
                        unit: null,
                        priceNet: 29.9,
                        priceGross: 35.58,
                        billingCycle: 'monthly',
                        currency: 'EUR',
                        taxRate: 19,
                        taxAmount: 5.68,
                        minimumTermUntil: null,
                        featuresSnapshot: ['CORE'],
                        quotaEffectsSnapshot: { storageGb: 5 },
                        metadata: null,
                    },
                ],
            });

            assert.deepEqual(created.entitlementSnapshot, entitlementSnapshot);
            assert.deepEqual(
                (await contracts.findById(created.id))?.entitlementSnapshot,
                entitlementSnapshot,
            );
            assert.deepEqual(
                (await contracts.findActiveByTenantId(tenantId, signedAt))?.entitlementSnapshot,
                entitlementSnapshot,
            );
        });

        // -------------------------------------------------------------
        test('a contract keeps what was agreed, and ending it does not rewrite it', async (t) => {
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const tenantId = 'tenant-contract-lifecycle';
            const signedAt = new Date('2026-01-01T00:00:00.000Z');
            const { subscriberId } = await createSubscriber({ legalName: 'Meier GmbH' });
            const parties = partiesWith(subscriberId, 'Meier GmbH');
            const created = await contracts.create({
                tenantId,
                parties,
                effectiveFrom: signedAt,
                priceSnapshot: {
                    currency: 'EUR',
                    billingCycle: 'monthly',
                    subtotalNet: 29.9,
                    discountNet: 0,
                    totalNet: 29.9,
                    vatRate: 19,
                    totalGross: 35.58,
                },
                entitlementSnapshot: {
                    plan: 'STANDARD',
                    features: ['CORE'],
                    quotas: { users: 5 },
                },
                originalBundleVersionIds: ['bundle-version-1'],
                termsSnapshot: { noticePeriodDays: 30 },
                lineItems: [
                    {
                        kind: 'plan',
                        sourceKey: 'STANDARD',
                        sourceVersionId: 'plan-version-1',
                        titleSnapshot: 'Standard',
                        descriptionSnapshot: 'The plan as it was signed',
                        quantity: 1,
                        unit: null,
                        priceNet: 19.9,
                        priceGross: 23.68,
                        billingCycle: 'monthly',
                        currency: 'EUR',
                        taxRate: 19,
                        taxAmount: 3.78,
                        minimumTermUntil: new Date('2027-01-01T00:00:00.000Z'),
                        featuresSnapshot: ['CORE'],
                        quotaEffectsSnapshot: { users: 5 },
                        metadata: { origin: 'onboarding' },
                    },
                    {
                        kind: 'bundle',
                        sourceKey: 'EXTRA-SEATS',
                        sourceVersionId: 'bundle-version-1',
                        titleSnapshot: 'Extra seats',
                        descriptionSnapshot: null,
                        quantity: 1,
                        unit: 'seat',
                        priceNet: 10.0,
                        priceGross: 11.9,
                        billingCycle: 'monthly',
                        currency: 'EUR',
                        taxRate: 19,
                        taxAmount: 1.9,
                        minimumTermUntil: null,
                        featuresSnapshot: [],
                        quotaEffectsSnapshot: { users: 5 },
                        metadata: null,
                    },
                ],
            });

            // What was agreed comes back as it was agreed — the snapshot is the
            // evidence a dispute is settled against.
            assert.equal(created.status, 'active');
            assert.equal(created.tenantId, tenantId);
            // And whom it was agreed with: both parties, every member of both,
            // and not marked as a copy a migration made.
            assert.equal(created.subscriberId, subscriberId);
            assert.deepEqual(created.subscriber, parties.subscriber);
            assert.deepEqual(created.issuer, parties.issuer);
            assert.equal(created.partiesMigrated, false);
            assert.equal(created.lineItems.length, 2);
            assert.deepEqual(created.originalBundleVersionIds, ['bundle-version-1']);
            assert.deepEqual(created.termsSnapshot, { noticePeriodDays: 30 });
            const planLine = created.lineItems.find((item) => item.kind === 'plan');
            assert.ok(planLine, 'plan line expected');
            assert.equal(planLine.priceNet, 19.9, 'money must survive the round trip unrounded');
            assert.equal(planLine.priceGross, 23.68);
            assert.equal(planLine.billingCycle, 'monthly');
            assert.deepEqual(planLine.quotaEffectsSnapshot, { users: 5 });
            assert.equal(planLine.descriptionSnapshot, 'The plan as it was signed');
            assert.equal(
                planLine.minimumTermUntil?.getTime(),
                new Date('2027-01-01T00:00:00.000Z').getTime(),
                'the commitment is part of what was agreed',
            );
            assert.deepEqual(planLine.metadata, { origin: 'onboarding' });
            assert.equal(planLine.currency, 'EUR', 'the line says what it was booked in');
            assert.equal(planLine.taxRate, 19, 'the rate is a recorded fact, not the ratio');
            assert.equal(planLine.taxAmount, 3.78);
            assert.equal(
                Math.round((planLine.priceNet + planLine.taxAmount) * 100) / 100,
                planLine.priceGross,
                'the tax closes the gap between net and gross',
            );
            const bundleLine = created.lineItems.find((item) => item.kind === 'bundle');
            assert.ok(bundleLine, 'bundle line expected');
            // The nullable half of every one of those fields, so an adapter
            // that writes a default instead of a null is caught too.
            assert.equal(bundleLine.descriptionSnapshot, null);
            assert.equal(bundleLine.unit, 'seat');
            assert.equal(bundleLine.minimumTermUntil, null);
            assert.equal(bundleLine.metadata, null);

            const readBack = await contracts.findById(created.id);
            assert.ok(readBack, 'contract expected by id');
            assert.deepEqual(readBack.subscriber, parties.subscriber, 'the copy is stored');
            assert.deepEqual(readBack.issuer, parties.issuer);
            assert.equal(
                readBack.lineItems.length,
                2,
                'lines belong to the contract, not the call',
            );

            // In force from the day it starts, and not a moment before.
            assert.equal(
                (
                    await contracts.findActiveByTenantId(
                        tenantId,
                        new Date('2026-06-01T00:00:00.000Z'),
                    )
                )?.id,
                created.id,
            );
            assert.equal(
                await contracts.findActiveByTenantId(
                    tenantId,
                    new Date('2025-12-31T23:59:59.999Z'),
                ),
                null,
                'a contract is not active before it starts',
            );

            // Ending it writes a window, and leaves everything else alone.
            const endsAt = new Date('2026-07-01T00:00:00.000Z');
            const terminated = await contracts.terminate(created.id, {
                tenantId: created.tenantId,
                effectiveUntil: endsAt,
                status: null,
            });
            assert.equal(
                terminated.status,
                'active',
                'a null status leaves the contract in the state it had',
            );
            assert.equal(terminated.effectiveUntil?.getTime(), endsAt.getTime());
            assert.equal(terminated.lineItems.length, 2, 'ending a contract keeps its lines');
            assert.equal(
                terminated.priceSnapshot.totalNet,
                created.priceSnapshot.totalNet,
                'ending a contract does not restate its price',
            );

            // Still there, still readable — append-only means the row survives
            // its own end.
            const afterEnd = await contracts.findById(created.id);
            assert.ok(afterEnd, 'a terminated contract is still readable');
            assert.equal(afterEnd.lineItems.length, 2);

            assert.equal(
                (
                    await contracts.findActiveByTenantId(
                        tenantId,
                        new Date('2026-06-30T00:00:00.000Z'),
                    )
                )?.id,
                created.id,
                'active up to the moment it ends',
            );
            assert.equal(
                await contracts.findActiveByTenantId(tenantId, endsAt),
                null,
                'and not at that moment',
            );
        });

        test('a successor takes over without erasing the contract it replaces', async (t) => {
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const tenantId = 'tenant-contract-succession';
            const { subscriberId } = await createSubscriber({ legalName: 'Nachfolger KG' });
            const parties = partiesWith(subscriberId, 'Nachfolger KG');
            const handover = new Date('2026-04-01T00:00:00.000Z');
            // Setup, not subject: this test is about which contract is in
            // force, so the line is built once and repriced per contract.
            const lineAt = (priceNet: number, priceGross: number): NewContractLineItemData => ({
                kind: 'plan',
                sourceKey: 'STANDARD',
                sourceVersionId: null,
                titleSnapshot: 'Standard',
                descriptionSnapshot: null,
                quantity: 1,
                unit: null,
                priceNet,
                priceGross,
                billingCycle: 'monthly',
                currency: 'EUR',
                taxRate: 19,
                taxAmount: Math.round((priceGross - priceNet) * 100) / 100,
                minimumTermUntil: null,
                featuresSnapshot: [],
                quotaEffectsSnapshot: {},
                metadata: null,
            });
            const priceAt = (net: number, gross: number) => ({
                currency: 'EUR',
                billingCycle: 'monthly' as const,
                subtotalNet: net,
                discountNet: 0,
                totalNet: net,
                vatRate: 19,
                totalGross: gross,
            });
            const first = await contracts.create({
                tenantId,
                parties,
                effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
                priceSnapshot: priceAt(19.9, 23.68),
                lineItems: [lineAt(19.9, 23.68)],
            });
            // While it is the live agreement, the active lookup finds it.
            assert.equal(
                (
                    await contracts.findActiveByTenantId(
                        tenantId,
                        new Date('2026-03-31T00:00:00.000Z'),
                    )
                )?.id,
                first.id,
            );
            await contracts.terminate(first.id, {
                tenantId: first.tenantId,
                effectiveUntil: handover,
                status: 'superseded',
            });
            const second = await contracts.create({
                tenantId,
                parties,
                effectiveFrom: handover,
                priceSnapshot: priceAt(24.9, 29.63),
                lineItems: [lineAt(24.9, 29.63)],
            });

            assert.equal(
                (await contracts.findActiveByTenantId(tenantId, handover))?.id,
                second.id,
                'the successor takes over at the moment the predecessor ends',
            );
            // And the predecessor is gone from that lookup for good — not
            // merely outside its window. `findActiveByTenantId` answers "which
            // agreement is live", and `superseded` is not a live status, so
            // passing it an earlier `asOf` does not bring the old contract
            // back. That question — what was in force then — is `list`'s, and
            // the next assertions are it.
            assert.equal(
                await contracts.findActiveByTenantId(
                    tenantId,
                    new Date('2026-03-31T00:00:00.000Z'),
                ),
                null,
                'a superseded contract is not live at any asOf',
            );

            const superseded = await contracts.findById(first.id);
            assert.equal(superseded?.status, 'superseded');
            assert.equal(
                superseded?.priceSnapshot.totalNet,
                19.9,
                'the replaced contract keeps the price it was signed at',
            );

            const history = await contracts.list({ tenantId });
            assert.equal(history.length, 2, 'both contracts remain in the history');
            // Each contract carries its own lines, at its own price. Listing
            // two at once is where an adapter that reads the lines in one
            // query can hand them all to whichever contract came first.
            assert.deepEqual(
                history.map((contract) => contract.lineItems.map((item) => item.priceNet)),
                [[24.9], [19.9]],
            );
            assert.deepEqual(
                history.map((contract) => contract.id),
                [second.id, first.id],
                'newest first',
            );
            assert.deepEqual(
                (
                    await contracts.list({ tenantId, asOf: new Date('2026-03-31T00:00:00.000Z') })
                ).map((contract) => contract.id),
                [first.id],
                'asOf narrows the history to what was in force then',
            );
            assert.deepEqual(
                (await contracts.list({ tenantId, status: 'superseded' })).map(
                    (contract) => contract.id,
                ),
                [first.id],
            );
        });

        // -------------------------------------------------------------
        test('a line keeps the currency and the tax it was booked with', async (t) => {
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const tenantId = 'tenant-contract-money-facts';
            const { subscriberId } = await createSubscriber({ legalName: 'Zürich AG' });
            // No issuer named that day: the copy says so, rather than an empty party.
            const parties = { ...partiesWith(subscriberId, 'Zürich AG'), issuer: null };
            const created = await contracts.create({
                tenantId,
                parties,
                effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
                priceSnapshot: {
                    currency: 'CHF',
                    billingCycle: 'monthly',
                    subtotalNet: 100,
                    discountNet: 10,
                    totalNet: 90,
                    vatRate: 8.1,
                    totalGross: 97.29,
                },
                lineItems: [
                    {
                        kind: 'plan',
                        sourceKey: 'STANDARD',
                        sourceVersionId: null,
                        titleSnapshot: 'Standard',
                        descriptionSnapshot: null,
                        quantity: 1,
                        unit: null,
                        priceNet: 100,
                        priceGross: 108.1,
                        billingCycle: 'monthly',
                        // Not the installation this suite's other contracts
                        // run under, and not a whole number of per cent —
                        // a rate stored as an integer, or a currency taken
                        // from a default, passes every other case here.
                        currency: 'CHF',
                        taxRate: 8.1,
                        taxAmount: 8.1,
                        minimumTermUntil: null,
                        featuresSnapshot: [],
                        quotaEffectsSnapshot: {},
                        metadata: null,
                    },
                    {
                        kind: 'discount',
                        sourceKey: 'WELCOME10',
                        sourceVersionId: null,
                        titleSnapshot: 'Welcome discount',
                        descriptionSnapshot: null,
                        quantity: 1,
                        unit: null,
                        priceNet: -10,
                        priceGross: -10.81,
                        billingCycle: 'monthly',
                        currency: 'CHF',
                        taxRate: 8.1,
                        taxAmount: -0.81,
                        minimumTermUntil: null,
                        featuresSnapshot: [],
                        quotaEffectsSnapshot: {},
                        metadata: null,
                    },
                ],
            });

            const read = await contracts.findById(created.id);
            const plan = read?.lineItems.find((item) => item.kind === 'plan');
            const discount = read?.lineItems.find((item) => item.kind === 'discount');
            assert.ok(plan && discount, 'both lines expected');
            assert.equal(plan.currency, 'CHF');
            assert.equal(plan.taxRate, 8.1, 'a fractional rate survives the column');
            assert.equal(plan.taxAmount, 8.1);
            // A discount reduces the tax as well as the price, so the sign has
            // to survive too — a column that only ever saw positive money
            // reads the same either way until one arrives.
            assert.equal(discount.currency, 'CHF');
            assert.equal(discount.taxRate, 8.1);
            assert.equal(discount.taxAmount, -0.81);
            for (const line of [plan, discount]) {
                assert.equal(
                    Math.round((line.priceNet + line.taxAmount) * 100) / 100,
                    line.priceGross,
                    'net plus tax is gross, on every line',
                );
            }
        });

        test('a contract written on a transaction is undone with it, and found by its offer', async (t) => {
            // Concluding an offer writes its contract on the transaction that
            // consumes the offer, and a retry asks for the contract by offer.
            // An adapter that wrote past the transaction would leave a contract
            // for an offer that is still open.
            const { adapter, seed } = harness;
            const contracts = adapter.subscriptionContractRepository;
            if (!contracts || !seed.createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            const { subscriberId } = await seed.createSubscriber({ legalName: 'Angebot GmbH' });
            const parties = partiesWith(subscriberId, 'Angebot GmbH');

            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    await contracts.create(contractFromOffer('offer-rolled-back', parties), tx);
                    throw new Error('the conclusion fails after the contract is written');
                }),
            );
            assert.equal(
                await contracts.findByOriginalOfferId('offer-rolled-back'),
                null,
                'the contract outlived its transaction',
            );

            const kept = await adapter.transactionRunner.run((tx) =>
                contracts.create(contractFromOffer('offer-kept', parties), tx),
            );
            const found = await contracts.findByOriginalOfferId('offer-kept');
            assert.equal(found?.id, kept.id);
            assert.equal(found?.lineItems.length, 1, 'with its lines');
            assert.equal(await contracts.findByOriginalOfferId('offer-nobody-concluded'), null);
        });

        test("a contract is neither superseded nor ended under another tenant's id", async (t) => {
            // The tenant is in the statement as well as the id, so an id that
            // reaches the write by mistake cannot end another tenant's contract
            // — also where no row policy would stop it.
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Grenze GmbH' });
            const parties = partiesWith(subscriberId, 'Grenze GmbH');
            const running = await contracts.create(contractFromOffer('offer-foreign-id', parties));
            const stranger = `${running.tenantId}-stranger`;

            assert.equal(
                await contracts.supersede(running.id, {
                    tenantId: stranger,
                    at: new Date('2026-03-01T00:00:00.000Z'),
                    readEffectiveUntil: null,
                }),
                null,
                "superseded under another tenant's id",
            );
            await assert.rejects(
                contracts.terminate(running.id, {
                    tenantId: stranger,
                    effectiveUntil: new Date('2026-03-01T00:00:00.000Z'),
                    status: 'terminated',
                }),
                refusedAs(CONTRACT_ERROR_CODES.SUBSCRIPTION_CONTRACT_NOT_FOUND, {
                    contractId: running.id,
                }),
            );
            const unchanged = await contracts.findById(running.id);
            assert.equal(unchanged?.status, running.status);
            assert.equal(unchanged?.effectiveUntil, null, 'still running');
        });

        test('a contract is superseded only while it is as the caller read it', async (t) => {
            // A plan change and an operator's refresh both read the contract in
            // force and write a successor. The condition on the write is what
            // keeps the second of them from superseding it again — and from
            // superseding one whose end a cancellation declared in between.
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Nachfolge GmbH' });
            const parties = partiesWith(subscriberId, 'Nachfolge GmbH');
            const at = new Date('2026-03-01T00:00:00.000Z');
            const running = await contracts.create(contractFromOffer('offer-superseded', parties));

            assert.equal(
                await contracts.supersede(running.id, {
                    tenantId: running.tenantId,
                    at,
                    readEffectiveUntil: new Date('2026-12-31T00:00:00.000Z'),
                }),
                null,
                'superseded against an end it does not have',
            );
            const superseded = await contracts.supersede(running.id, {
                tenantId: running.tenantId,
                at,
                readEffectiveUntil: null,
            });
            assert.equal(superseded?.status, 'superseded');
            assert.equal(superseded?.effectiveUntil?.toISOString(), at.toISOString());
            assert.equal(superseded?.lineItems.length, 1, 'with its lines');
            assert.equal(
                await contracts.supersede(running.id, {
                    tenantId: running.tenantId,
                    at,
                    readEffectiveUntil: null,
                }),
                null,
                'superseded twice',
            );
            assert.equal(
                (await contracts.findById(running.id))?.effectiveUntil?.toISOString(),
                at.toISOString(),
            );

            // A contract whose end a cancellation declared, read by two writers,
            // and superseded by the first at exactly that end: the end the
            // second read is still there, and only the status tells it that
            // the contract has moved on.
            const capped = await contracts.create(contractFromOffer('offer-capped', parties));
            const endsAt = new Date('2026-12-31T00:00:00.000Z');
            await contracts.terminate(capped.id, {
                tenantId: capped.tenantId,
                effectiveUntil: endsAt,
                status: null,
            });
            const first = await contracts.supersede(capped.id, {
                tenantId: capped.tenantId,
                at: endsAt,
                readEffectiveUntil: endsAt,
            });
            assert.equal(first?.status, 'superseded', 'a capped contract read with its end');
            assert.equal(
                await contracts.supersede(capped.id, {
                    tenantId: capped.tenantId,
                    at,
                    readEffectiveUntil: endsAt,
                }),
                null,
                'superseded again by a writer that read the same end',
            );
            assert.equal(
                (await contracts.findById(capped.id))?.effectiveUntil?.toISOString(),
                endsAt.toISOString(),
            );
        });

        test('two writers superseding one contract at once end with one successor', async (t) => {
            const { adapter, seed } = harness;
            const contracts = adapter.subscriptionContractRepository;
            if (!contracts || !seed.createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            const { subscriberId } = await seed.createSubscriber({ legalName: 'Wettlauf GmbH' });
            const parties = partiesWith(subscriberId, 'Wettlauf GmbH');
            const running = await contracts.create(contractFromOffer('offer-raced', parties));
            const at = new Date('2026-04-01T00:00:00.000Z');
            const successor = (offerId: string): NewSubscriptionContractData => ({
                ...contractFromOffer(offerId, parties),
                tenantId: running.tenantId,
                effectiveFrom: at,
            });

            const written = await Promise.all(
                ['offer-raced-a', 'offer-raced-b'].map((offerId) =>
                    adapter.transactionRunner.run(async (tx) => {
                        const ended = await contracts.supersede(
                            running.id,
                            { tenantId: running.tenantId, at, readEffectiveUntil: null },
                            tx,
                        );
                        return ended ? contracts.create(successor(offerId), tx) : null;
                    }),
                ),
            );

            assert.equal(written.filter(Boolean).length, 1, 'exactly one successor');
            const inForce = await contracts.list({ tenantId: running.tenantId, asOf: at });
            assert.equal(inForce.length, 1, 'one contract in force');
        });

        test('a supersession written on a transaction is undone with it', async (t) => {
            const { adapter, seed } = harness;
            const contracts = adapter.subscriptionContractRepository;
            if (!contracts || !seed.createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            const { subscriberId } = await seed.createSubscriber({ legalName: 'Rückroll GmbH' });
            const running = await contracts.create(
                contractFromOffer(
                    'offer-supersede-rolled-back',
                    partiesWith(subscriberId, 'Rückroll GmbH'),
                ),
            );

            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    await contracts.supersede(
                        running.id,
                        {
                            tenantId: running.tenantId,
                            at: new Date('2026-05-01T00:00:00.000Z'),
                            readEffectiveUntil: null,
                        },
                        tx,
                    );
                    throw new Error('the successor could not be written');
                }),
            );
            const still = await contracts.findById(running.id);
            assert.equal(still?.status, 'active');
            assert.equal(still?.effectiveUntil, null, 'the supersession outlived its transaction');
        });

        test('a successor that takes over a copy the migration made stays marked as one', async (t) => {
            // A successor may keep the parties of the contract it replaces. Where
            // those were copied by the migration rather than agreed, the mark
            // goes with them, or the copy passes for what was agreed one
            // contract later.
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Kopie GmbH' });
            const parties = partiesWith(subscriberId, 'Kopie GmbH');

            const marked = await contracts.create({
                ...contractFromOffer('offer-parties-migrated', parties),
                partiesMigrated: true,
            });
            const agreed = await contracts.create(
                contractFromOffer('offer-parties-agreed', parties),
            );

            assert.equal(marked.partiesMigrated, true);
            assert.equal((await contracts.findById(marked.id))?.partiesMigrated, true);
            assert.equal(agreed.partiesMigrated, false);
        });

        // -------------------------------------------------------------
        // Subscribers — the party a contract is concluded with
        // -------------------------------------------------------------

        test('a subscriber is created live for its tenant, and numbered by the database', async (t) => {
            const subscribers = harness.adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            const first = await subscribers.createForTenant({
                ...subscriberFor('tenant-subscriber-first', 'Erste Autohaus GmbH'),
                vatId: 'DE123456789',
                addressLine1: 'Hauptstraße 1',
                postalCode: '10115',
                city: 'Berlin',
                country: 'DE',
                invoiceEmail: 'rechnung@erste.example',
                customerNumberPrefix: 'K-',
            });
            const second = await subscribers.createForTenant(
                subscriberFor('tenant-subscriber-second', 'Zweiter Verein e.V.'),
            );
            assert.ok(first && second, 'both tenants had no subscriber');

            // The number is the database's, counted on; the prefix is the one
            // each was created with, and a later one renames nobody.
            const numberOf = (customerNumber: string) => Number(customerNumber.replace('K-', ''));
            assert.ok(first.customerNumber.startsWith('K-'), first.customerNumber);
            assert.equal(numberOf(second.customerNumber), numberOf(first.customerNumber) + 1);
            assert.ok(numberOf(first.customerNumber) >= 10001, first.customerNumber);

            const found = await subscribers.findByTenantId('tenant-subscriber-first');
            assert.deepEqual(
                found && {
                    id: found.id,
                    customerNumber: found.customerNumber,
                    tenantId: found.tenantId,
                    legalName: found.legalName,
                    vatId: found.vatId,
                    taxNumber: found.taxNumber,
                    addressLine1: found.addressLine1,
                    addressLine2: found.addressLine2,
                    postalCode: found.postalCode,
                    city: found.city,
                    country: found.country,
                    invoiceEmail: found.invoiceEmail,
                    migrated: found.migrated,
                },
                {
                    id: first.id,
                    customerNumber: first.customerNumber,
                    tenantId: 'tenant-subscriber-first',
                    legalName: 'Erste Autohaus GmbH',
                    vatId: 'DE123456789',
                    // The nullable half, so an adapter writing '' is caught too.
                    taxNumber: null,
                    addressLine1: 'Hauptstraße 1',
                    addressLine2: null,
                    postalCode: '10115',
                    city: 'Berlin',
                    country: 'DE',
                    invoiceEmail: 'rechnung@erste.example',
                    migrated: false,
                },
            );
            assert.equal(
                (await subscribers.findById(second.id))?.tenantId,
                'tenant-subscriber-second',
            );
            assert.equal(await subscribers.findByTenantId('tenant-without-subscriber'), null);
            assert.equal(await subscribers.findById('subscriber-nobody-created'), null);
        });

        test('a tenant has one live subscriber: a second is refused, and the transaction survives it', async (t) => {
            const { adapter } = harness;
            const subscribers = adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            const first = await subscribers.createForTenant(
                subscriberFor('tenant-one-subscriber', 'Einzig GmbH'),
            );

            const afterRefusal = await adapter.transactionRunner.run(async (tx) => {
                const refused = await subscribers.createForTenant(
                    subscriberFor('tenant-one-subscriber', 'Doppelt GmbH'),
                    tx,
                );
                assert.equal(refused, null, 'a second live subscriber was created');
                // A refusal that aborted the transaction would fail this write.
                return subscribers.createForTenant(
                    subscriberFor('tenant-after-refusal', 'Danach GmbH'),
                    tx,
                );
            });

            assert.equal(
                (await subscribers.findByTenantId('tenant-one-subscriber'))?.id,
                first?.id,
            );
            assert.equal(
                (await subscribers.findByTenantId('tenant-after-refusal'))?.id,
                afterRefusal?.id,
                'the transaction did not survive the refusal',
            );
        });

        test('creating a subscriber for one tenant twice at once ends with one', async (t) => {
            const subscribers = harness.adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            const results = await Promise.all([
                subscribers.createForTenant(subscriberFor('tenant-at-once', 'Gleichzeitig A')),
                subscribers.createForTenant(subscriberFor('tenant-at-once', 'Gleichzeitig B')),
            ]);
            const created = results.filter((result) => result !== null);
            assert.equal(created.length, 1, `${created.length} subscribers were created`);
            assert.equal((await subscribers.findByTenantId('tenant-at-once'))?.id, created[0]!.id);
        });

        test('a subscriber written on a transaction is undone with it', async (t) => {
            const { adapter } = harness;
            const subscribers = adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    await subscribers.createForTenant(
                        subscriberFor('tenant-rolled-back', 'Zurückgerollt GmbH'),
                        tx,
                    );
                    throw new Error('the tenant is not created after all');
                }),
            );
            assert.equal(await subscribers.findByTenantId('tenant-rolled-back'), null);
            // And the tenant is free for the attempt that goes through.
            assert.ok(
                await subscribers.createForTenant(
                    subscriberFor('tenant-rolled-back', 'Zurückgerollt GmbH'),
                ),
            );
        });

        test('a contact change writes what it names and keeps the rest', async (t) => {
            const subscribers = harness.adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            const created = await subscribers.createForTenant({
                ...subscriberFor('tenant-contact', 'Kontakt GmbH'),
                addressLine2: 'Hinterhaus',
                city: 'Hamburg',
            });
            assert.ok(created);

            const changed = await subscribers.updateContact(
                created.id,
                {
                    city: 'Bremen',
                    addressLine2: null,
                    invoiceEmail: 'buchhaltung@kontakt.example',
                },
                TENANT_USER,
            );

            assert.deepEqual(
                changed && [
                    changed.city,
                    changed.addressLine2,
                    changed.invoiceEmail,
                    changed.legalName,
                    changed.tenantId,
                ],
                ['Bremen', null, 'buchhaltung@kontakt.example', 'Kontakt GmbH', 'tenant-contact'],
            );
            assert.equal((await subscribers.findById(created.id))?.city, 'Bremen');
            assert.equal(
                await subscribers.updateContact(
                    'subscriber-nobody-created',
                    { city: 'Kiel' },
                    TENANT_USER,
                ),
                null,
            );
        });

        test('a correction records the values it replaced, and nothing when nothing moves', async (t) => {
            const subscribers = harness.adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            const created = await subscribers.createForTenant(
                subscriberFor('tenant-correction', 'Mueller GmbH'),
            );
            assert.ok(created);

            const umlaut = await timed(() =>
                subscribers.correctIdentity(created.id, {
                    corrected: { legalName: 'Müller GmbH', vatId: 'DE123456789', taxNumber: null },
                    reason: 'Umlaut lost when the registration was typed',
                    correctedBy: 'operator:anna',
                }),
            );
            const first = umlaut.result;
            // `taxNumber` was already null, so it moved nothing and is not recorded.
            assert.deepEqual(
                first?.correction && {
                    previous: first.correction.previous,
                    corrected: first.correction.corrected,
                    reason: first.correction.reason,
                    correctedBy: first.correction.correctedBy,
                },
                {
                    previous: { legalName: 'Mueller GmbH', vatId: null },
                    corrected: { legalName: 'Müller GmbH', vatId: 'DE123456789' },
                    reason: 'Umlaut lost when the registration was typed',
                    correctedBy: 'operator:anna',
                },
            );
            assert.ok(
                first?.correction && inWindow(first.correction.correctedAt, umlaut),
                'the correction is not dated by the write that made it',
            );
            assert.equal(first?.subscriber.legalName, 'Müller GmbH');
            assert.equal((await subscribers.findById(created.id))?.vatId, 'DE123456789');

            const unchanged = await subscribers.correctIdentity(created.id, {
                corrected: { legalName: 'Müller GmbH' },
                reason: 'Clicked twice',
                correctedBy: 'operator:anna',
            });
            assert.equal(
                unchanged?.correction,
                null,
                'a correction that moved nothing was recorded',
            );

            await subscribers.correctIdentity(created.id, {
                corrected: { vatId: 'DE999999999' },
                reason: 'Wrong VAT id on the first correction',
                correctedBy: 'operator:ben',
            });
            const listed = await subscribers.listCorrections(created.id);
            assert.deepEqual(
                listed.map((correction) => correction.reason),
                [
                    'Wrong VAT id on the first correction',
                    'Umlaut lost when the registration was typed',
                ],
                'corrections come back the latest written first, and only the two that moved something',
            );
            assert.equal(
                await subscribers.correctIdentity('subscriber-nobody-created', {
                    corrected: { legalName: 'Niemand' },
                    reason: 'none',
                    correctedBy: 'operator:anna',
                }),
                null,
            );
        });

        test('two corrections at once each record the value the other left behind', async (t) => {
            const { adapter } = harness;
            const subscribers = adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no transactions or no row locks');
                return;
            }
            const created = await subscribers.createForTenant(
                subscriberFor('tenant-corrected-twice', 'Original GmbH'),
            );
            assert.ok(created);
            // Each correction holds its transaction open a moment after writing,
            // so the other one arrives while it is uncommitted. Without a lock the
            // second reads 'Original GmbH' and records that as what it replaced.
            const correctTo = (legalName: string) =>
                adapter.transactionRunner.run(async (tx) => {
                    await subscribers.correctIdentity(
                        created.id,
                        {
                            corrected: { legalName },
                            reason: `to ${legalName}`,
                            correctedBy: 'operator:anna',
                        },
                        tx,
                    );
                    await sleep(LOCK_HOLD_MS);
                });
            await Promise.all([
                correctTo('Erste Korrektur GmbH'),
                correctTo('Zweite Korrektur GmbH'),
            ]);

            const listed = await subscribers.listCorrections(created.id);
            assert.equal(listed.length, 2, JSON.stringify(listed));
            // Listed the latest written first: the earlier write replaced the
            // original, the later one what the earlier one wrote.
            assert.equal(listed[1]!.previous.legalName, 'Original GmbH', JSON.stringify(listed));
            assert.equal(
                listed[0]!.previous.legalName,
                listed[1]!.corrected.legalName,
                `a correction recorded a value it did not replace: ${JSON.stringify(listed)}`,
            );
            assert.equal(
                (await subscribers.findById(created.id))?.legalName,
                listed[0]!.corrected.legalName,
            );
            assert.ok(
                listed[0]!.correctedAt.getTime() >= listed[1]!.correctedAt.getTime(),
                'the later write is dated before the earlier one',
            );
        });

        test("a contract keeps its subscriber's copy after the subscriber is corrected", async (t) => {
            const { adapter } = harness;
            const subscribers = adapter.subscriberRepository;
            const contracts = adapter.subscriptionContractRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            if (!contracts || !harness.seed.createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const subscriber = await subscribers.createForTenant(
                subscriberFor('tenant-copy-kept', 'Vorher GmbH'),
            );
            assert.ok(subscriber);
            const parties = partiesWith(subscriber.id, 'Vorher GmbH');
            const contract = await contracts.create({
                ...contractFromOffer('offer-copy-kept', parties),
                tenantId: 'tenant-copy-kept',
            });

            await subscribers.correctIdentity(subscriber.id, {
                corrected: { legalName: 'Nachher GmbH' },
                reason: 'Change of name of the same company',
                correctedBy: 'operator:anna',
            });

            const readBack = await contracts.findById(contract.id);
            assert.equal(readBack?.subscriberId, subscriber.id);
            assert.equal(
                readBack?.subscriber.legalName,
                'Vorher GmbH',
                'the contract followed a correction of the live record',
            );
        });

        // -------------------------------------------------------------
        // The subscriber's tax origin, and the treatment a contract records
        // -------------------------------------------------------------

        test('whether a subscriber is a business is kept as stated, and unknown until it is', async (t) => {
            const subscribers = harness.adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            const business = await subscribers.createForTenant({
                ...subscriberFor('tenant-business', 'Zürich Software GmbH'),
                country: 'CH',
                business: true,
            });
            const consumer = await subscribers.createForTenant({
                ...subscriberFor('tenant-consumer', 'Erika Mustermann'),
                business: false,
            });
            const notStated = await subscribers.createForTenant(
                subscriberFor('tenant-business-not-stated', 'Undecided GmbH'),
            );
            assert.ok(business && consumer && notStated);

            // Read back rather than taken from the create, which could hand back
            // what it was given; and `false` apart from `null`, so an adapter
            // writing one for the other is caught.
            const readBack = await Promise.all(
                [business, consumer, notStated].map(
                    async (created) => (await subscribers.findById(created.id))?.business,
                ),
            );
            assert.deepEqual(readBack, [true, false, null]);
            assert.equal((await subscribers.findByTenantId('tenant-business'))?.business, true);
        });

        test('a change of the tax origin is recorded with who made it and when, whichever way it arrives', async (t) => {
            const subscribers = harness.adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            const created = await subscribers.createForTenant({
                ...subscriberFor('tenant-tax-origin', 'Wien Handel GmbH'),
                country: 'DE',
                city: 'München',
            });
            assert.ok(created);

            // A contact change that leaves the country records nothing.
            await subscribers.updateContact(created.id, { city: 'Passau' }, TENANT_USER);
            assert.deepEqual(await subscribers.listTaxOriginChanges(created.id), []);

            const moved = await timed(() =>
                subscribers.updateContact(created.id, { country: 'AT', city: 'Wien' }, TENANT_USER),
            );
            // The billing details saved again as they are, as a form sends them
            // whole: the country is named, and moves nothing.
            await subscribers.updateContact(
                created.id,
                { country: 'AT', city: 'Wien' },
                TENANT_USER,
            );
            const corrected = await timed(() =>
                subscribers.correctIdentity(created.id, {
                    corrected: { vatId: 'ATU12345678' },
                    reason: 'VAT id handed in after sign-up',
                    correctedBy: 'operator:anna',
                }),
            );
            // A correction of the name alone leaves the tax origin as it is.
            await subscribers.correctIdentity(created.id, {
                corrected: { legalName: 'Wien Handel GesmbH' },
                reason: 'Legal form spelt as registered',
                correctedBy: 'operator:anna',
            });
            const stated = await timed(() =>
                subscribers.changeBusinessStatus(created.id, {
                    business: true,
                    changedBy: 'operator:ben',
                }),
            );
            assert.equal(stated.result?.subscriber.business, true);
            assert.equal((await subscribers.findById(created.id))?.business, true);
            assert.deepEqual(
                stated.result?.change && [
                    stated.result.change.previous,
                    stated.result.change.changed,
                ],
                [{ business: null }, { business: true }],
            );

            const again = await subscribers.changeBusinessStatus(created.id, {
                business: true,
                changedBy: 'operator:ben',
            });
            assert.equal(again?.change, null, 'a business status that did not move was recorded');
            assert.equal(again?.subscriber.business, true);

            const listed = await subscribers.listTaxOriginChanges(created.id);
            assert.deepEqual(
                listed.map((change) => ({
                    subscriberId: change.subscriberId,
                    previous: change.previous,
                    changed: change.changed,
                    changedBy: change.changedBy,
                })),
                [
                    {
                        subscriberId: created.id,
                        previous: { business: null },
                        changed: { business: true },
                        changedBy: 'operator:ben',
                    },
                    {
                        subscriberId: created.id,
                        previous: { vatId: null },
                        changed: { vatId: 'ATU12345678' },
                        changedBy: 'operator:anna',
                    },
                    {
                        subscriberId: created.id,
                        previous: { country: 'DE' },
                        changed: { country: 'AT' },
                        changedBy: TENANT_USER,
                    },
                ],
                'the changes come back the latest written first, and only the three that moved the tax origin',
            );
            // Each dated while its own write ran, so the dates read in the order
            // the changes were written.
            const windows = [stated, corrected, moved];
            listed.forEach((change, index) => {
                assert.ok(
                    inWindow(change.changedAt, windows[index]!),
                    `change ${index} is dated ${change.changedAt.toISOString()}, outside its write`,
                );
            });
            // One write, one date: the correction and the change it made.
            assert.equal(
                corrected.result?.correction?.correctedAt.getTime(),
                listed[1]!.changedAt.getTime(),
                'a correction and the change of the tax origin it made are dated apart',
            );
            assert.equal(
                await subscribers.changeBusinessStatus('subscriber-nobody-created', {
                    business: true,
                    changedBy: 'operator:ben',
                }),
                null,
            );
            assert.deepEqual(
                await subscribers.listTaxOriginChanges('subscriber-nobody-created'),
                [],
            );
        });

        test('every VAT id check is kept as answered, and the one that counts is the latest of the number held', async (t) => {
            const subscribers = harness.adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            const created = await subscribers.createForTenant({
                ...subscriberFor('tenant-vat-check', 'Prüf GmbH'),
                country: 'AT',
                vatId: 'ATU12345678',
            });
            assert.ok(created);
            assert.equal(
                await subscribers.findCurrentVatIdCheck(created.id),
                null,
                'a number nobody checked reads as checked',
            );
            const checkOf = (vatId: string, day: string, valid: boolean): VatIdCheck => ({
                vatId,
                checkedAt: new Date(`${day}T08:30:00.000Z`),
                valid,
                service: 'VIES',
                confirmation: { requestIdentifier: `WAPI-${vatId}-${day}`, name: 'PRÜF GMBH' },
            });
            const summary = (check: VatIdCheck | null | undefined) =>
                check && [check.vatId, check.checkedAt.toISOString().slice(0, 10), check.valid];

            const first = await subscribers.recordVatIdCheck(
                created.id,
                checkOf('ATU12345678', '2026-10-01', true),
            );
            assert.deepEqual(
                first && {
                    subscriberId: first.recorded.subscriberId,
                    vatId: first.recorded.vatId,
                    checkedAt: first.recorded.checkedAt.getTime(),
                    valid: first.recorded.valid,
                    service: first.recorded.service,
                    confirmation: first.recorded.confirmation,
                },
                {
                    subscriberId: created.id,
                    vatId: 'ATU12345678',
                    checkedAt: new Date('2026-10-01T08:30:00.000Z').getTime(),
                    valid: true,
                    service: 'VIES',
                    confirmation: {
                        requestIdentifier: 'WAPI-ATU12345678-2026-10-01',
                        name: 'PRÜF GMBH',
                    },
                },
            );
            assert.equal(first?.current?.id, first?.recorded.id);
            assert.equal(
                (await subscribers.findCurrentVatIdCheck(created.id))?.id,
                first?.recorded.id,
            );

            // A check of another number is recorded, and counts for nothing.
            const stray = await subscribers.recordVatIdCheck(
                created.id,
                checkOf('ATU99999999', '2026-10-02', false),
            );
            assert.equal(stray?.current?.id, first?.recorded.id);

            // A check that completed later counts from now on, whatever it found …
            const revoked = await subscribers.recordVatIdCheck(
                created.id,
                checkOf('ATU12345678', '2026-11-01', false),
            );
            assert.equal(revoked?.current?.id, revoked?.recorded.id);
            // … and one that completed earlier but is written later does not
            // replace it: an older "valid" never overrides a newer "invalid".
            const older = await subscribers.recordVatIdCheck(
                created.id,
                checkOf('ATU12345678', '2026-10-15', true),
            );
            assert.equal(older?.current?.id, revoked?.recorded.id);
            assert.deepEqual(summary(await subscribers.findCurrentVatIdCheck(created.id)), [
                'ATU12345678',
                '2026-11-01',
                false,
            ]);

            // Once the number is corrected, no check counts for the new one, and
            // a check of the old one that finishes after the correction counts
            // for nothing either.
            await subscribers.correctIdentity(created.id, {
                corrected: { vatId: 'ATU87654321' },
                reason: 'Digits swapped when the number was typed',
                correctedBy: 'operator:anna',
            });
            assert.equal(await subscribers.findCurrentVatIdCheck(created.id), null);
            const late = await subscribers.recordVatIdCheck(
                created.id,
                checkOf('ATU12345678', '2026-12-01', true),
            );
            assert.equal(late?.current, null);
            // Corrected back to the number checked before, no earlier check
            // counts again: the number may have been revoked in between.
            await subscribers.correctIdentity(created.id, {
                corrected: { vatId: 'ATU12345678' },
                reason: 'The first number was right after all',
                correctedBy: 'operator:anna',
            });
            assert.equal(await subscribers.findCurrentVatIdCheck(created.id), null);

            // And none of it is lost: every check is still there as answered.
            const kept = await subscribers.listVatIdChecks(created.id);
            assert.deepEqual(kept.map(summary), [
                ['ATU12345678', '2026-12-01', true],
                ['ATU12345678', '2026-11-01', false],
                ['ATU12345678', '2026-10-15', true],
                ['ATU99999999', '2026-10-02', false],
                ['ATU12345678', '2026-10-01', true],
            ]);
            assert.deepEqual(kept.at(-1)?.confirmation, {
                requestIdentifier: 'WAPI-ATU12345678-2026-10-01',
                name: 'PRÜF GMBH',
            });

            // A check of the number completed before the correction back, and
            // written only after it, counts for nothing: the subscriber did not
            // hold the number when it was checked. One completed since counts.
            const stale = await subscribers.recordVatIdCheck(
                created.id,
                checkOf('ATU12345678', '2026-10-03', true),
            );
            assert.equal(stale?.current, null, 'a check from before the correction back counts');
            const fresh = await subscribers.recordVatIdCheck(created.id, {
                ...checkOf('ATU12345678', '2026-10-03', true),
                checkedAt: new Date(),
            });
            assert.equal(fresh?.current?.id, fresh?.recorded.id);

            assert.equal(
                await subscribers.recordVatIdCheck(
                    'subscriber-nobody-created',
                    checkOf('ATU12345678', '2026-10-01', true),
                ),
                null,
            );
            assert.equal(
                await subscribers.findCurrentVatIdCheck('subscriber-nobody-created'),
                null,
            );
            assert.deepEqual(await subscribers.listVatIdChecks('subscriber-nobody-created'), []);
        });

        test('two checks of one number recorded at once leave the later-dated one counting', async (t) => {
            const { adapter } = harness;
            const subscribers = adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no transactions or no row locks');
                return;
            }
            const created = await subscribers.createForTenant({
                ...subscriberFor('tenant-checked-twice', 'Doppelt GmbH'),
                vatId: 'ATU12345678',
            });
            assert.ok(created);
            // The later-dated check starts first and holds its transaction open,
            // so the earlier-dated one is written after it. Without the lock both
            // read "no check counts" and the one written last would count.
            const recordAt = (day: string, valid: boolean) =>
                adapter.transactionRunner.run(async (tx) => {
                    await subscribers.recordVatIdCheck(
                        created.id,
                        {
                            vatId: 'ATU12345678',
                            checkedAt: new Date(`${day}T08:30:00.000Z`),
                            valid,
                            service: 'VIES',
                            confirmation: {},
                        },
                        tx,
                    );
                    await sleep(LOCK_HOLD_MS);
                });
            await Promise.all([
                recordAt('2026-11-01', false),
                sleep(LOCK_HOLD_MS / 3).then(() => recordAt('2026-10-01', true)),
            ]);

            const counting = await subscribers.findCurrentVatIdCheck(created.id);
            assert.equal(counting?.checkedAt.toISOString(), '2026-11-01T08:30:00.000Z');
            assert.equal((await subscribers.listVatIdChecks(created.id)).length, 2);
        });

        test('two changes of the country at once each record the value the other left behind', async (t) => {
            const { adapter } = harness;
            const subscribers = adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no transactions or no row locks');
                return;
            }
            const created = await subscribers.createForTenant({
                ...subscriberFor('tenant-moved-twice', 'Umzug GmbH'),
                country: 'DE',
            });
            assert.ok(created);
            // As with two corrections: each holds its transaction open after
            // writing, so the other arrives while it is uncommitted. Without a
            // lock both read 'DE' and record it as what they replaced.
            const moveTo = (country: string) =>
                adapter.transactionRunner.run(async (tx) => {
                    await subscribers.updateContact(created.id, { country }, TENANT_USER, tx);
                    await sleep(LOCK_HOLD_MS);
                });
            await Promise.all([moveTo('AT'), moveTo('CH')]);

            const listed = await subscribers.listTaxOriginChanges(created.id);
            assert.equal(listed.length, 2, JSON.stringify(listed));
            // Listed the latest written first: the earlier write replaced 'DE',
            // the later one what the earlier one wrote.
            assert.equal(listed[1]!.previous.country, 'DE', JSON.stringify(listed));
            assert.equal(
                listed[0]!.previous.country,
                listed[1]!.changed.country,
                `a change recorded a country it did not replace: ${JSON.stringify(listed)}`,
            );
            assert.equal(
                (await subscribers.findById(created.id))?.country,
                listed[0]!.changed.country,
            );
            assert.ok(
                listed[0]!.changedAt.getTime() >= listed[1]!.changedAt.getTime(),
                'the later write is dated before the earlier one',
            );
        });

        test('the subscribers of many tenants are read at once, each with the check that counts', async (t) => {
            const subscribers = harness.adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            const checked = await subscribers.createForTenant({
                ...subscriberFor('tenant-many-checked', 'Viele GmbH'),
                country: 'AT',
                vatId: 'ATU12345678',
            });
            const unchecked = await subscribers.createForTenant(
                subscriberFor('tenant-many-unchecked', 'Wenige GmbH'),
            );
            const elsewhere = await subscribers.createForTenant(
                subscriberFor('tenant-many-elsewhere', 'Anderswo GmbH'),
            );
            assert.ok(checked && unchecked && elsewhere);
            const recorded = await subscribers.recordVatIdCheck(checked.id, {
                vatId: 'ATU12345678',
                checkedAt: new Date('2026-10-01T08:30:00.000Z'),
                valid: true,
                service: 'VIES',
                confirmation: { requestIdentifier: 'WAPI-MANY' },
            });

            const found = await subscribers.listForTenants([
                'tenant-many-checked',
                'tenant-many-unchecked',
                'tenant-many-checked',
                'tenant-many-without-subscriber',
            ]);

            assert.deepEqual(
                found
                    .map((entry) => [
                        entry.subscriber.tenantId,
                        entry.subscriber.id,
                        entry.subscriber.legalName,
                        entry.currentVatIdCheck?.id ?? null,
                    ])
                    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
                [
                    ['tenant-many-checked', checked.id, 'Viele GmbH', recorded?.recorded.id],
                    ['tenant-many-unchecked', unchecked.id, 'Wenige GmbH', null],
                ],
                'each tenant named once, with its subscriber and the check that counts; a tenant without one and a tenant not named are left out',
            );
            const counting = found.find(
                (entry) => entry.subscriber.id === checked.id,
            )?.currentVatIdCheck;
            assert.ok(counting?.checkedAt instanceof Date, 'the check is read back with its date');
            assert.deepEqual(await subscribers.listForTenants([]), []);
        });

        test('a change of the tax origin written on a transaction is undone with it', async (t) => {
            const { adapter } = harness;
            const subscribers = adapter.subscriberRepository;
            if (!subscribers) {
                missing(t, 'subscribers');
                return;
            }
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            const created = await subscribers.createForTenant({
                ...subscriberFor('tenant-tax-origin-rolled-back', 'Rückzug GmbH'),
                country: 'DE',
                vatId: 'DE123456789',
            });
            assert.ok(created);

            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    await subscribers.updateContact(created.id, { country: 'FR' }, TENANT_USER, tx);
                    await subscribers.changeBusinessStatus(
                        created.id,
                        { business: true, changedBy: 'operator:anna' },
                        tx,
                    );
                    await subscribers.recordVatIdCheck(
                        created.id,
                        {
                            vatId: 'DE123456789',
                            checkedAt: new Date(),
                            valid: true,
                            service: 'VIES',
                            confirmation: {},
                        },
                        tx,
                    );
                    throw new Error('the change is not made after all');
                }),
            );

            const found = await subscribers.findById(created.id);
            assert.deepEqual([found?.country, found?.business], ['DE', null]);
            assert.deepEqual(
                await subscribers.listTaxOriginChanges(created.id),
                [],
                'a change was recorded for a write that was undone',
            );
            assert.deepEqual(await subscribers.listVatIdChecks(created.id), []);
            assert.equal(await subscribers.findCurrentVatIdCheck(created.id), null);
        });

        test('a contract records the tax treatment it was concluded with, and none where none was decided', async (t) => {
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Umkehr GmbH' });
            const parties = partiesWith(subscriberId, 'Umkehr GmbH');
            const reverseCharge: TaxTreatment = {
                kind: 'reverse-charge',
                rate: 0,
                note: 'Steuerschuldnerschaft des Leistungsempfängers',
                adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
            };
            const standard: TaxTreatment = {
                kind: 'standard',
                rate: 19,
                note: null,
                adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
            };

            const abroad = await contracts.create({
                ...contractFromOffer('offer-tax-reverse-charge', parties),
                taxTreatment: reverseCharge,
            });
            const domestic = await contracts.create({
                ...contractFromOffer('offer-tax-standard', parties),
                taxTreatment: standard,
            });
            const undecided = await contracts.create(
                contractFromOffer('offer-tax-undecided', parties),
            );

            assert.deepEqual(abroad.taxTreatment, reverseCharge);
            assert.deepEqual((await contracts.findById(abroad.id))?.taxTreatment, reverseCharge);
            assert.deepEqual((await contracts.findById(domestic.id))?.taxTreatment, standard);
            assert.equal(undecided.taxTreatment, null);
            assert.equal((await contracts.findById(undecided.id))?.taxTreatment, null);
        });

        test('the contracts still running say which issuer each names', async (t) => {
            // What a start reads before it lets the operator's own legal identity
            // move: an undeclared change of it is refused, and the refusal names
            // these. Running is `active` or `scheduled` AND not ended at `asOf`
            // — status alone would count every contract an ordinary cancellation
            // ended, because that writes only the window. A contract whose party
            // copy the migration made names no issuer at all.
            const { adapter } = harness;
            const contracts = adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!contracts || !createSubscriber) {
                missing(t, 'subscriptionContracts');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Meier GmbH' });
            const parties = partiesWith(subscriberId, 'Meier GmbH');
            const written = async (
                offerId: string,
                overrides: Partial<NewSubscriptionContractData>,
            ) => contracts.create({ ...contractFromOffer(offerId, parties), ...overrides });

            const oldest = await written('running-oldest', {
                effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            });
            const scheduled = await written('running-scheduled', {
                effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
                status: 'scheduled',
            });
            // Active, and its window closed: this is what an ordinary
            // cancellation leaves behind — `effectiveUntil` at the term end and
            // the status untouched, because nothing flips it when that day
            // comes. Counting by status alone would call it running for ever.
            const lapsed = await written('running-lapsed', {
                effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
                effectiveUntil: new Date('2026-04-01T00:00:00.000Z'),
            });
            // The other side of that window: ends later, so it is running.
            const ending = await written('running-ending', {
                effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
                effectiveUntil: new Date('2026-12-01T00:00:00.000Z'),
            });
            // What the migration that attached older contracts leaves: a party
            // copy with no issuer in it.
            const noIssuer = await written('running-no-issuer', {
                effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
                parties: { ...parties, issuer: null },
            });
            await written('running-terminated', {
                effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
                status: 'terminated',
            });
            await written('running-superseded', {
                effectiveFrom: new Date('2025-02-01T00:00:00.000Z'),
                status: 'superseded',
            });

            const asOf = new Date('2026-06-01T00:00:00.000Z');
            const listed = await contracts.listRunningIssuers(10, asOf);
            assert.equal(listed.total, 4, 'a contract that ended or was ended is not running');
            assert.deepEqual(
                listed.contracts.map((row) => row.id),
                [oldest.id, scheduled.id, ending.id, noIssuer.id],
                'oldest first, and the one whose term ran out is not among them',
            );
            assert.ok(
                !listed.contracts.some((row) => row.id === lapsed.id),
                'a window that closed ends a contract, whatever its status still says',
            );
            // The boundary, from the other side: before it closed, it counts.
            const earlier = await contracts.listRunningIssuers(
                10,
                new Date('2026-03-15T00:00:00.000Z'),
            );
            assert.equal(earlier.total, 5);
            assert.ok(earlier.contracts.some((row) => row.id === lapsed.id));
            assert.equal(listed.contracts[0].tenantId, oldest.tenantId);
            assert.equal(
                listed.contracts[0].effectiveFrom.getTime(),
                new Date('2026-01-01T00:00:00.000Z').getTime(),
            );
            assert.equal(listed.contracts[0].issuerLegalName, 'Example Software GmbH');
            assert.equal(
                listed.contracts[3].issuerLegalName,
                null,
                'a contract with no issuer copy says so rather than inventing one',
            );

            const capped = await contracts.listRunningIssuers(2, asOf);
            assert.equal(capped.total, 4, 'the limit caps the list, not the count');
            assert.deepEqual(
                capped.contracts.map((row) => row.id),
                [oldest.id, scheduled.id],
            );

            // Zero means zero. A caller that wants only the number passes it,
            // and an implementation reading a falsy limit as "no limit" hands
            // back every running contract to answer a count — the one shape of
            // this method that gets slower the more an installation sells.
            const counted = await contracts.listRunningIssuers(0, asOf);
            assert.equal(counted.total, 4);
            assert.deepEqual(counted.contracts, []);
        });

        // -------------------------------------------------------------
        // Payments — gateway events claimed once, and payment methods
        // -------------------------------------------------------------

        test('a gateway event is claimed once per account, and a duplicate leaves the transaction usable', async (t) => {
            const { adapter } = harness;
            const log = adapter.paymentEventLog;
            if (!log) {
                missing(t, 'paymentEventLog');
                return;
            }
            const claims = await adapter.transactionRunner.run(async (tx) => [
                await log.claim(eventAt('stripe-main', 'evt_1'), tx),
                await log.claim(eventAt('stripe-main', 'evt_1'), tx),
                // The same identifier from another account is another event.
                await log.claim(eventAt('stripe-old', 'evt_1'), tx),
                // A duplicate that raised would have aborted the transaction here.
                await log.claim(eventAt('stripe-main', 'evt_2'), tx),
            ]);
            assert.deepEqual(claims, [true, false, true, true]);

            const later = await adapter.transactionRunner.run((tx) =>
                log.claim(eventAt('stripe-main', 'evt_1'), tx),
            );
            assert.equal(later, false, 'a committed claim was claimed again');
        });

        test('one gateway session is confirmed once, however many events report it', async (t) => {
            const { adapter } = harness;
            const log = adapter.paymentEventLog;
            if (!log) {
                missing(t, 'paymentEventLog');
                return;
            }
            const session = 'cs_reported_twice';
            const claims = await adapter.transactionRunner.run(async (tx) => [
                await log.claim(
                    eventAt('stripe-main', 'evt_form_done', { sessionId: session }),
                    tx,
                ),
                // The same session, reported again under another identifier:
                // recording it would set the session's payment method up twice.
                await log.claim(
                    eventAt('stripe-main', 'evt_method_on', { sessionId: session }),
                    tx,
                ),
                // Another account's session of that name is another session.
                await log.claim(eventAt('stripe-old', 'evt_elsewhere', { sessionId: session }), tx),
                // A kind that says nothing about the session being confirmed.
                await log.claim(
                    eventAt('stripe-main', 'evt_gave_up', {
                        sessionId: session,
                        kind: 'payment-method-setup-failed',
                    }),
                    tx,
                ),
                // Events about no session at all do not collide with each other.
                await log.claim(
                    eventAt('stripe-main', 'evt_other_1', { sessionId: null, kind: 'unhandled' }),
                    tx,
                ),
                await log.claim(
                    eventAt('stripe-main', 'evt_other_2', { sessionId: null, kind: 'unhandled' }),
                    tx,
                ),
            ]);
            assert.deepEqual(claims, [true, false, true, true, true, true]);

            const later = await adapter.transactionRunner.run((tx) =>
                log.claim(eventAt('stripe-main', 'evt_late', { sessionId: session }), tx),
            );
            assert.equal(later, false, 'a session already confirmed was confirmed again');
        });

        test('a claim rolled back with its transaction is free for the retry', async (t) => {
            const { adapter } = harness;
            const log = adapter.paymentEventLog;
            if (!log) {
                missing(t, 'paymentEventLog');
                return;
            }
            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    assert.equal(await log.claim(eventAt('stripe-main', 'evt_retry'), tx), true);
                    throw new Error('recording what the event changes failed');
                }),
                /recording what the event changes failed/,
            );
            const retry = await adapter.transactionRunner.run((tx) =>
                log.claim(eventAt('stripe-main', 'evt_retry'), tx),
            );
            assert.equal(retry, true, 'the retry was discarded as a duplicate');
        });

        test('a delivery that meets a claim still open waits for it, and answers by its outcome', async (t) => {
            const { adapter } = harness;
            const log = adapter.paymentEventLog;
            if (!log) {
                missing(t, 'paymentEventLog');
                return;
            }
            if (!adapter.capabilities.pessimisticLocking) {
                t.skip(
                    'adapter declares no pessimistic locking: an open claim cannot be waited on',
                );
                return;
            }
            // Committed: the second delivery is the duplicate.
            const [committed, afterCommit] = await Promise.all([
                adapter.transactionRunner.run(async (tx) => {
                    const claimed = await log.claim(eventAt('stripe-main', 'evt_race'), tx);
                    await sleep(LOCK_HOLD_MS);
                    return claimed;
                }),
                sleep(LOCK_HOLD_MS / 3).then(() =>
                    adapter.transactionRunner.run((tx) =>
                        log.claim(eventAt('stripe-main', 'evt_race'), tx),
                    ),
                ),
            ]);
            assert.deepEqual([committed, afterCommit], [true, false]);

            // Rolled back: the second delivery is the one that handles it.
            const [rolledBack, afterRollback] = await Promise.allSettled([
                adapter.transactionRunner.run(async (tx) => {
                    await log.claim(eventAt('stripe-main', 'evt_race_back'), tx);
                    await sleep(LOCK_HOLD_MS);
                    throw new Error('the first delivery failed');
                }),
                sleep(LOCK_HOLD_MS / 3).then(() =>
                    adapter.transactionRunner.run((tx) =>
                        log.claim(eventAt('stripe-main', 'evt_race_back'), tx),
                    ),
                ),
            ]);
            assert.equal(rolledBack.status, 'rejected');
            assert.deepEqual(afterRollback, { status: 'fulfilled', value: true });
        });

        test('an event that changed nothing gives its session back, and stays claimed itself', async (t) => {
            const { adapter } = harness;
            const log = adapter.paymentEventLog;
            if (!log) {
                missing(t, 'paymentEventLog');
                return;
            }
            const session = 'cs_nothing_to_do';
            const released = await adapter.transactionRunner.run(async (tx) => {
                await log.claim(eventAt('stripe-main', 'evt_missed', { sessionId: session }), tx);
                // What a handler does when the confirmation names a setup
                // nobody opened: it gives the session back on this transaction.
                await log.releaseSession('stripe-main', 'evt_missed', tx);
                return [
                    // The next event about that session is handled …
                    await log.claim(
                        eventAt('stripe-main', 'evt_correct', { sessionId: session }),
                        tx,
                    ),
                    // … while the event that released it stays claimed.
                    await log.claim(eventAt('stripe-main', 'evt_missed', { sessionId: null }), tx),
                ];
            });
            assert.deepEqual(released, [true, false]);

            const again = await adapter.transactionRunner.run((tx) =>
                log.claim(eventAt('stripe-main', 'evt_after_correct', { sessionId: session }), tx),
            );
            assert.equal(again, false, 'the session was confirmed and is not free again');
        });

        test('two events confirming one session at once end with one claim', async (t) => {
            const { adapter } = harness;
            const log = adapter.paymentEventLog;
            if (!log) {
                missing(t, 'paymentEventLog');
                return;
            }
            if (!adapter.capabilities.pessimisticLocking) {
                t.skip(
                    'adapter declares no pessimistic locking: an open claim cannot be waited on',
                );
                return;
            }
            // Two identifiers, one session, delivered together: without the
            // session's own index both would be claimed, and each would set the
            // session's payment method up — a second tenant for one sign-up.
            const session = 'cs_at_once';
            const [first, second] = await Promise.all([
                adapter.transactionRunner.run(async (tx) => {
                    const claimed = await log.claim(
                        eventAt('stripe-main', 'evt_at_once_a', { sessionId: session }),
                        tx,
                    );
                    await sleep(LOCK_HOLD_MS);
                    return claimed;
                }),
                sleep(LOCK_HOLD_MS / 3).then(() =>
                    adapter.transactionRunner.run((tx) =>
                        log.claim(
                            eventAt('stripe-main', 'evt_at_once_b', { sessionId: session }),
                            tx,
                        ),
                    ),
                ),
            ]);
            assert.deepEqual([first, second], [true, false]);
        });

        test("a confirmed payment method becomes the subscriber's, with its references and masked details", async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Karte GmbH' });
            const debit = {
                ...paymentMethodFor(subscriberId, 'pm_sepa', '2026-09-01T10:00:00.000Z'),
                type: 'sepa_debit' as const,
                brand: null,
                last4: '3000',
                expiryMonth: null,
                expiryYear: null,
                country: 'DE',
                bankCode: '37040044',
                mandateReference: 'MANDATE-1',
            };

            const result = await methods.recordConfirmed(debit);

            assert.equal(result.outcome, 'activated');
            const { id, createdAt, ...stored } = result.method;
            assert.ok(id);
            assert.ok(createdAt instanceof Date);
            assert.deepEqual(stored, { ...debit, status: 'ACTIVE', replacedAt: null });
            assert.deepEqual(await methods.findActive(subscriberId), result.method);
            assert.deepEqual(
                await methods.findByReference(reference(subscriberId, 'pm_sepa')),
                result.method,
            );
            // A reference is meaningful only to its own account.
            assert.equal(
                await methods.findByReference(reference(subscriberId, 'pm_sepa', 'stripe-old')),
                null,
            );
            const other = await createSubscriber({ legalName: 'Second Customer GmbH' });
            assert.equal(await methods.findActive(other.subscriberId), null);
        });

        test('a newer payment method takes over, and the one it replaced stays as history', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Wechsel GmbH' });
            await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_first', '2026-09-01T10:00:00.000Z'),
            );

            const second = await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_second', '2026-09-02T10:00:00.000Z'),
            );

            assert.equal(second.outcome, 'activated');
            assert.equal((await methods.findActive(subscriberId))?.paymentMethodRef, 'pm_second');
            const first = await methods.findByReference(reference(subscriberId, 'pm_first'));
            assert.equal(first?.status, 'REPLACED');
            assert.equal(first?.replacedAt?.toISOString(), '2026-09-02T10:00:00.000Z');
        });

        test('a confirmation recorded again is recognised, and changes nothing', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Doppelt GmbH' });
            const confirmation = paymentMethodFor(
                subscriberId,
                'pm_twice',
                '2026-09-01T10:00:00.000Z',
            );
            const first = await methods.recordConfirmed(confirmation);

            const again = await methods.recordConfirmed({
                ...confirmation,
                confirmedAt: new Date('2026-09-03T10:00:00.000Z'),
            });

            assert.equal(again.outcome, 'already-recorded');
            assert.deepEqual(again.method, first.method);
            assert.deepEqual(await methods.findActive(subscriberId), first.method);
        });

        test('a reference belongs to one subscriber, and another one neither reads nor records it', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const holder = await createSubscriber({ legalName: 'Inhaberin GmbH' });
            const stranger = await createSubscriber({ legalName: 'Fremde GmbH' });
            const confirmation = paymentMethodFor(
                holder.subscriberId,
                'pm_of_the_holder',
                '2026-09-01T10:00:00.000Z',
            );
            await methods.recordConfirmed(confirmation);

            // Read and write are asked the same question from the wrong side.
            // The account's reference is unique account-wide, so neither has
            // anything but the subscriber to bound it with — and a gateway
            // callback, where this is reached, carries no tenant whose policy
            // would bound it instead.
            assert.equal(
                await methods.findByReference(reference(stranger.subscriberId, 'pm_of_the_holder')),
                null,
            );
            await assert.rejects(
                methods.recordConfirmed({
                    ...confirmation,
                    subscriberId: stranger.subscriberId,
                    confirmedAt: new Date('2026-09-02T10:00:00.000Z'),
                }),
                /belongs to another subscriber/,
                "answering `already-recorded` would hand out the holder's payment method",
            );
            assert.equal(await methods.findActive(stranger.subscriberId), null);
            assert.deepEqual(
                await methods.findByReference(reference(holder.subscriberId, 'pm_of_the_holder')),
                await methods.findActive(holder.subscriberId),
                'the refusal left the holder with the payment method it had',
            );
        });

        test('two subscribers confirming one reference at once: the second is refused in the same words', async (t) => {
            const { adapter } = harness;
            const methods = adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const holder = await createSubscriber({ legalName: 'Zugleich Inhaberin GmbH' });
            const stranger = await createSubscriber({ legalName: 'Zugleich Fremde GmbH' });
            // The stranger has one of its own, so the refusal has something to
            // leave alone — and so the read below says more than `null`.
            await methods.recordConfirmed(
                paymentMethodFor(
                    stranger.subscriberId,
                    'pm_of_the_stranger',
                    '2026-08-01T10:00:00.000Z',
                ),
            );

            const [held, refused] = await Promise.allSettled([
                adapter.transactionRunner.run(async (tx) => {
                    const result = await methods.recordConfirmed(
                        paymentMethodFor(
                            holder.subscriberId,
                            'pm_at_once_shared',
                            '2026-09-01T10:00:00.000Z',
                        ),
                        tx,
                    );
                    await sleep(LOCK_HOLD_MS);
                    return result;
                }),
                sleep(LOCK_HOLD_MS / 3).then(() =>
                    adapter.transactionRunner.run(async (tx) => {
                        // The read cannot see the other transaction's row, so
                        // this refusal is the reference's own key answering.
                        await assert.rejects(
                            methods.recordConfirmed(
                                paymentMethodFor(
                                    stranger.subscriberId,
                                    'pm_at_once_shared',
                                    '2026-09-01T10:00:01.000Z',
                                ),
                                tx,
                            ),
                            /belongs to another subscriber/,
                        );
                        // And the caller still has its transaction: the refusal
                        // came before the first write of its own, so there is
                        // nothing to undo and nothing that stops it being used.
                        return methods.findActive(stranger.subscriberId, tx);
                    }),
                ),
            ]);

            assert.equal(held.status, 'fulfilled');
            assert.equal(
                refused.status,
                'fulfilled',
                String((refused as { reason?: unknown }).reason),
            );
            assert.equal(
                refused.status === 'fulfilled'
                    ? (refused.value as SubscriberPaymentMethodRecord | null)?.paymentMethodRef
                    : null,
                'pm_of_the_stranger',
                'the refused confirmation left the stranger the payment method it had',
            );
            assert.equal(
                (await methods.findActive(holder.subscriberId))?.paymentMethodRef,
                'pm_at_once_shared',
            );
        });

        test('a confirmation older than the payment method in use is recorded as already replaced', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Reihenfolge GmbH' });
            // The form filled in second was confirmed first.
            await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_later', '2026-09-02T10:00:00.000Z'),
            );

            const earlier = await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_earlier', '2026-09-01T10:00:00.000Z'),
            );

            assert.equal(earlier.outcome, 'superseded');
            assert.equal(earlier.method.status, 'REPLACED');
            assert.equal(earlier.method.replacedAt?.toISOString(), '2026-09-02T10:00:00.000Z');
            assert.equal((await methods.findActive(subscriberId))?.paymentMethodRef, 'pm_later');
        });

        test('two confirmations for one subscriber at once leave one payment method in use', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Gleichzeitig GmbH' });

            const results = await Promise.all([
                methods.recordConfirmed(
                    paymentMethodFor(subscriberId, 'pm_at_once_a', '2026-09-01T10:00:00.000Z'),
                ),
                methods.recordConfirmed(
                    paymentMethodFor(subscriberId, 'pm_at_once_b', '2026-09-01T10:00:01.000Z'),
                ),
            ]);

            // Whichever takes the lock first, the later confirmation ends in use:
            // the earlier one is either replaced by it or recorded as replaced.
            for (const result of results) {
                assert.ok(
                    result.outcome === 'activated' || result.outcome === 'superseded',
                    result.outcome,
                );
            }
            const statuses = await Promise.all(
                ['pm_at_once_a', 'pm_at_once_b'].map(
                    async (ref) =>
                        (await methods.findByReference(reference(subscriberId, ref)))?.status,
                ),
            );
            assert.deepEqual(statuses, ['REPLACED', 'ACTIVE']);
            assert.equal(
                (await methods.findActive(subscriberId))?.paymentMethodRef,
                'pm_at_once_b',
            );
        });

        test('a payment method written on a transaction is undone with it', async (t) => {
            const { adapter } = harness;
            const methods = adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Rolled Back GmbH' });
            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    await methods.recordConfirmed(
                        paymentMethodFor(
                            subscriberId,
                            'pm_rolled_back',
                            '2026-09-01T10:00:00.000Z',
                        ),
                        tx,
                    );
                    throw new Error('the activation failed after all');
                }),
                /the activation failed after all/,
            );
            assert.equal(await methods.findActive(subscriberId), null);
            assert.equal(
                await methods.findByReference(reference(subscriberId, 'pm_rolled_back')),
                null,
            );
        });

        test('a payment method for a subscriber that does not exist is refused', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            if (!methods || !harness.seed.createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            await assert.rejects(
                methods.recordConfirmed(
                    paymentMethodFor(
                        'subscriber-nobody-created',
                        'pm_nobody',
                        '2026-09-01T10:00:00.000Z',
                    ),
                ),
            );
            assert.equal(
                await methods.findByReference(reference('subscriber-nobody-created', 'pm_nobody')),
                null,
            );
        });

        test('the accounts in use are those holding a payment method in use, each once', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            assert.deepEqual(await methods.accountsInUse(), []);
            const moved = await createSubscriber({ legalName: 'Umgezogen GmbH' });
            const stayed = await createSubscriber({ legalName: 'Geblieben GmbH' });
            await methods.recordConfirmed(
                paymentMethodFor(
                    moved.subscriberId,
                    'pm_old_account',
                    '2026-09-01T10:00:00.000Z',
                    'stripe-old',
                ),
            );
            await methods.recordConfirmed(
                paymentMethodFor(
                    moved.subscriberId,
                    'pm_new_account',
                    '2026-09-02T10:00:00.000Z',
                    'stripe-main',
                ),
            );
            await methods.recordConfirmed(
                paymentMethodFor(
                    stayed.subscriberId,
                    'pm_main',
                    '2026-09-02T10:00:00.000Z',
                    'stripe-main',
                ),
            );

            // `stripe-old` holds a reference, but only one a newer payment method replaced.
            assert.deepEqual(await methods.accountsInUse(), ['stripe-main']);
        });

        test('a setup is completed once, and only by the account, session and subscriber it was started with', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Setup GmbH' });
            const other = await createSubscriber({ legalName: 'Other Tenant GmbH' });
            await methods.recordSetup({
                subscriberId,
                gatewayAccount: 'stripe-main',
                sessionRef: 'cs_setup',
                customerRef: 'cus_setup',
                startedAt: new Date('2026-09-15T10:00:00.000Z'),
            });
            const at = new Date('2026-09-15T10:05:00.000Z');
            const match = { gatewayAccount: 'stripe-main', sessionRef: 'cs_setup', subscriberId };

            // A callback naming another subscriber than the session was opened for.
            assert.equal(
                await methods.completeSetup({ ...match, subscriberId: other.subscriberId }, at),
                false,
            );
            assert.equal(
                await methods.completeSetup({ ...match, gatewayAccount: 'stripe-old' }, at),
                false,
            );
            assert.equal(
                await methods.completeSetup({ ...match, sessionRef: 'cs_nobody_opened' }, at),
                false,
            );

            assert.equal(await methods.completeSetup(match, at), true);
            assert.equal(
                await methods.completeSetup(match, at),
                false,
                'a setup was completed twice',
            );
        });

        test('a setup completed on a transaction that rolls back is open again', async (t) => {
            const { adapter } = harness;
            const methods = adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Retry GmbH' });
            const match = { gatewayAccount: 'stripe-main', sessionRef: 'cs_retry', subscriberId };
            await methods.recordSetup({
                ...match,
                customerRef: 'cus_retry',
                startedAt: new Date('2026-09-15T10:00:00.000Z'),
            });
            const at = new Date('2026-09-15T10:05:00.000Z');

            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    assert.equal(await methods.completeSetup(match, at, tx), true);
                    throw new Error('recording the payment method failed');
                }),
                /recording the payment method failed/,
            );

            assert.equal(
                await methods.completeSetup(match, at),
                true,
                'the rollback kept the completion',
            );
        });

        test('one session is one setup, however often it is recorded', async (t) => {
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!methods || !createSubscriber) {
                missing(t, 'subscriberPaymentMethods');
                return;
            }
            const { subscriberId } = await createSubscriber({ legalName: 'Once GmbH' });
            const setup = {
                subscriberId,
                gatewayAccount: 'stripe-main',
                sessionRef: 'cs_once',
                customerRef: 'cus_once',
                startedAt: new Date('2026-09-15T10:00:00.000Z'),
            };
            await methods.recordSetup(setup);

            await assert.rejects(methods.recordSetup(setup));
        });

        // -------------------------------------------------------------
        // The subscriber's account — a charge is written once, to the cent
        // -------------------------------------------------------------

        /**
         * A subscriber, a contract with a plan line and a discount line, and a
         * charge builder pointing at them — the foreign keys a charge carries
         * are real. Null where the adapter provides no journal.
         */
        async function anAccount(t: TestContext, tenantId: string) {
            const ledger = harness.adapter.subscriberLedgerRepository;
            const contracts = harness.adapter.subscriptionContractRepository;
            const createSubscriber = harness.seed.createSubscriber;
            if (!ledger || !contracts || !createSubscriber) {
                missing(t, 'subscriberLedger');
                return null;
            }
            const { subscriberId } = await createSubscriber({ legalName: `${tenantId} GmbH` });
            const line = (
                kind: 'plan' | 'discount',
                sourceKey: string,
                priceNet: number,
            ): NewContractLineItemData => ({
                kind,
                sourceKey,
                sourceVersionId: null,
                titleSnapshot: sourceKey,
                descriptionSnapshot: null,
                quantity: 1,
                unit: null,
                priceNet,
                priceGross: Math.round(priceNet * 119) / 100,
                billingCycle: 'monthly',
                currency: 'EUR',
                taxRate: 19,
                taxAmount: Math.round(priceNet * 19) / 100,
                minimumTermUntil: null,
                featuresSnapshot: [],
                quotaEffectsSnapshot: {},
                metadata: null,
            });
            const contract = await contracts.create({
                tenantId,
                parties: partiesWith(subscriberId, `${tenantId} GmbH`),
                effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
                priceSnapshot: {
                    currency: 'EUR',
                    billingCycle: 'monthly',
                    subtotalNet: 19.9,
                    discountNet: 3.98,
                    totalNet: 15.92,
                    vatRate: 19,
                    totalGross: 18.94,
                },
                lineItems: [line('plan', 'STANDARD', 19.9), line('discount', 'WELCOME20', -3.98)],
            });
            const planLine = contract.lineItems.find((item) => item.kind === 'plan')!;
            const discountLine = contract.lineItems.find((item) => item.kind === 'discount')!;
            const subscriptionId = `sub-${tenantId}`;
            const charge = (overrides: Partial<NewSubscriberCharge> = {}): NewSubscriberCharge => ({
                subscriberId,
                tenantId,
                subscriptionId,
                contractId: contract.id,
                contractLineItemId: planLine.id,
                origin: 'renewal',
                source: 'plan',
                sourceRef: subscriptionId,
                periodStart: new Date('2026-02-01T00:00:00.000Z'),
                periodEnd: new Date('2026-03-01T00:00:00.000Z'),
                currency: 'EUR',
                amountNet: 19.9,
                bookedAt: new Date('2026-02-01T00:00:00.000Z'),
                ...overrides,
            });
            return { ledger, subscriptionId, discountLineId: discountLine.id, charge };
        }

        test('a charge is written once, however often it is recorded', async (t) => {
            // Every derivation writes every charge it finds, so a second call —
            // a renewal job run twice, a retried deploy — hands the same charge
            // over again. The account must not grow by it.
            const account = await anAccount(t, 'tenant-ledger-once');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;

            const first = await ledger.recordCharges([charge()]);
            const again = await ledger.recordCharges([charge()]);
            const twiceInOneCall = await ledger.recordCharges([
                charge({ periodStart: new Date('2026-03-01T00:00:00.000Z') }),
                charge({ periodStart: new Date('2026-03-01T00:00:00.000Z') }),
            ]);

            assert.equal(first.length, 1);
            assert.equal(again.length, 0, 'a charge written before came back as written again');
            assert.equal(twiceInOneCall.length, 1);
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 2);
        });

        test('callers recording the same charge at the same time write it once', async (t) => {
            // The key decides, not a read before the write: two derivations that
            // both saw no charge must not both write one.
            const account = await anAccount(t, 'tenant-ledger-race');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;

            const results = await Promise.all(
                Array.from({ length: 4 }, () => ledger.recordCharges([charge()])),
            );

            assert.equal(
                results.reduce((sum, written) => sum + written.length, 0),
                1,
            );
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 1);
        });

        test('a charge keeps its amount to the cent, and a discount stays below zero', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-cents');
            if (!account) return;
            const { ledger, subscriptionId, discountLineId, charge } = account;

            await ledger.recordCharges([
                charge({ amountNet: 19.9 }),
                charge({
                    source: 'discount',
                    sourceRef: 'WELCOME20',
                    contractLineItemId: discountLineId,
                    amountNet: -3.98,
                }),
                charge({ sourceRef: 'large', amountNet: 99_999_999.99 }),
            ]);

            const amounts = (await ledger.listBySubscription(subscriptionId)).map(
                (entry) => entry.amountNet,
            );
            assert.deepEqual(
                [...amounts].sort((a, b) => a - b),
                [-3.98, 19.9, 99_999_999.99],
            );
        });

        test('another period, origin or source reference is a charge of its own', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-keys');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;

            const written = await ledger.recordCharges([
                charge(),
                charge({ periodStart: new Date('2026-03-01T00:00:00.000Z') }),
                charge({ origin: 'planChange' }),
                charge({ sourceRef: 'another-booking', source: 'bundle' }),
            ]);

            assert.equal(written.length, 4);
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 4);
        });

        test("a subscription's charges come back oldest period first", async (t) => {
            const account = await anAccount(t, 'tenant-ledger-order');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;
            const month = (m: number) => new Date(Date.UTC(2026, m, 1));

            await ledger.recordCharges([
                charge({ periodStart: month(3), periodEnd: month(4) }),
                charge({ periodStart: month(1), periodEnd: month(2) }),
                charge({ periodStart: month(2), periodEnd: month(3) }),
            ]);

            const starts = (await ledger.listBySubscription(subscriptionId)).map((entry) =>
                entry.periodStart.toISOString(),
            );
            assert.deepEqual(
                starts,
                [month(1), month(2), month(3)].map((d) => d.toISOString()),
            );
            assert.deepEqual(await ledger.listBySubscription('sub-nobody'), []);
        });

        test('a charge written on a transaction is undone with it', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-rollback');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;

            await assert.rejects(
                harness.adapter.transactionRunner.run(async (tx) => {
                    await ledger.recordCharges([charge()], tx);
                    throw new Error('the change the charge belonged to failed');
                }),
            );

            assert.deepEqual(await ledger.listBySubscription(subscriptionId), []);
            assert.equal((await ledger.recordCharges([charge()])).length, 1);
        });

        test('a charge naming a contract line that does not exist is refused', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-orphan');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;

            await assert.rejects(
                ledger.recordCharges([charge({ contractLineItemId: 'no-such-line' })]),
            );
            assert.deepEqual(await ledger.listBySubscription(subscriptionId), []);
        });

        // -------------------------------------------------------------
        // Checkout offers — consumed once, and undone with their transaction
        // -------------------------------------------------------------

        test('an offer is consumed once, whoever asks first', async (t) => {
            const offers = harness.adapter.checkoutOfferRepository;
            if (!offers) {
                missing(t, 'checkoutOffers');
                return;
            }
            const offer = await offers.create(OFFER);
            assert.equal(offer.status, 'open');

            // The condition belongs on the write: a check before it sees both
            // callers find the offer open.
            const attempts = await Promise.allSettled([
                offers.consume(offer.id),
                offers.consume(offer.id),
            ]);
            assert.equal(
                attempts.filter((attempt) => attempt.status === 'fulfilled').length,
                1,
                'exactly one consume wins',
            );
            const consumed = await offers.findById(offer.id);
            assert.equal(consumed?.status, 'consumed');
            assert.ok(consumed?.consumedAt, 'and it records when');

            await assert.rejects(() => offers.consume(offer.id), 'a later consume is refused');
            assert.equal(
                (await offers.findById(offer.id))?.consumedAt,
                consumed.consumedAt,
                'and changes nothing',
            );
        });

        test('a consume on a transaction that rolls back leaves the offer open', async (t) => {
            const { adapter } = harness;
            const offers = adapter.checkoutOfferRepository;
            if (!offers) {
                missing(t, 'checkoutOffers');
                return;
            }
            if (!adapter.capabilities.transactions) {
                t.skip('adapter declares no transaction capability');
                return;
            }
            const offer = await offers.create(OFFER);

            await assert.rejects(
                adapter.transactionRunner.run(async (tx) => {
                    await offers.consume(offer.id, tx);
                    throw new Error('the contract after the consume fails');
                }),
            );
            const afterwards = await offers.findById(offer.id);
            assert.equal(afterwards?.status, 'open', 'the consume outlived its transaction');
            assert.equal(afterwards?.consumedAt, null);

            // Open, so it can be concluded again.
            assert.equal((await offers.consume(offer.id)).status, 'consumed');
        });

        // -------------------------------------------------------------
        // The applied settings — one row per installation, and its changes
        // -------------------------------------------------------------

        const SETTINGS: AppliedSettingsValues = {
            app: { name: 'Demo' },
            currency: 'EUR',
            vatRate: 19,
            tenantBilling: {
                cancellationNoticeDays: { monthly: 14, yearly: 90 },
                selfServiceBlockedPlans: { asTarget: ['ENTERPRISE'], asSource: [] },
            },
        };
        const SOURCE = '/srv/app/config/saas.yaml';
        const FIRST_START = new Date('2026-09-01T06:30:00.000Z');
        const SECOND_START = new Date('2026-09-02T06:30:00.000Z');
        const applied = (
            fingerprint: string,
            appliedAt: Date,
            settings: AppliedSettingsValues = SETTINGS,
        ) => ({ fingerprint, settings, source: SOURCE, appliedAt });
        /** What a start noticed: `previous` became `current`. */
        const changeTo = (
            current: AppliedSettingsValues,
            noticedAt: Date,
            previous: AppliedSettingsValues = SETTINGS,
        ) => ({ noticedAt, source: SOURCE, previous, current });
        const TWENTY = { ...SETTINGS, vatRate: 20 };
        const TWENTY_ONE = { ...SETTINGS, vatRate: 21 };

        test('no record before the first boot that could write one', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            assert.equal(await port.readApplied(), null);
            assert.deepEqual(await port.listChanges(), []);
        });

        test('the record comes back as it was written — values, source and moment', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            assert.equal(await port.writeApplied(applied('sha256-a', FIRST_START), null), true);

            const read = await port.readApplied();
            assert.ok(read, 'a record expected');
            assert.equal(read.fingerprint, 'sha256-a');
            assert.equal(read.source, SOURCE);
            assert.equal(read.appliedAt.toISOString(), FIRST_START.toISOString());
            // Numbers stay numbers and lists keep their order through the JSON
            // column: a notice period read back as "14" would compare unequal
            // to the file for ever, and report a change on every boot.
            assert.deepEqual(read.settings, SETTINGS);
        });

        test('writing again replaces the one row rather than adding a second', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            await port.writeApplied(applied('sha256-a', FIRST_START), null);
            assert.equal(
                await port.writeApplied(applied('sha256-b', SECOND_START, TWENTY), 'sha256-a'),
                true,
            );

            const read = await port.readApplied();
            assert.equal(read?.fingerprint, 'sha256-b');
            assert.equal(read?.appliedAt.toISOString(), SECOND_START.toISOString());
            assert.equal((read?.settings as { vatRate: number }).vatRate, 20);
        });

        test('the first record is written once: a second writer that read none is refused', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            assert.equal(await port.writeApplied(applied('sha256-a', FIRST_START), null), true);
            assert.equal(await port.writeApplied(applied('sha256-b', SECOND_START), null), false);
            assert.equal((await port.readApplied())?.fingerprint, 'sha256-a');
        });

        test('a write guarded on a fingerprint the row no longer carries is refused', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            await port.writeApplied(applied('sha256-a', FIRST_START), null);
            assert.equal(
                await port.writeApplied(applied('sha256-b', SECOND_START), 'sha256-a'),
                true,
            );
            // A second writer that also read 'sha256-a' arrives after the first.
            assert.equal(
                await port.writeApplied(applied('sha256-c', SECOND_START), 'sha256-a'),
                false,
            );
            const read = await port.readApplied();
            assert.equal(
                read?.fingerprint,
                'sha256-b',
                'the row stands as the first writer left it',
            );
            assert.equal(read?.appliedAt.toISOString(), SECOND_START.toISOString());
        });

        test('a change lands with the record it supersedes, and is listed newest first', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            await port.writeApplied(applied('sha256-a', FIRST_START), null);
            const first = await port.recordChange(
                changeTo(TWENTY, FIRST_START),
                applied('sha256-b', FIRST_START, TWENTY),
                'sha256-a',
            );
            const second = await port.recordChange(
                changeTo(TWENTY_ONE, SECOND_START, TWENTY),
                applied('sha256-c', SECOND_START, TWENTY_ONE),
                'sha256-b',
            );
            assert.ok(first && second, 'both guards held');
            assert.ok(first.id && second.id && first.id !== second.id, 'two distinct ids');
            assert.equal(first.acknowledgedAt, null);
            assert.equal(first.acknowledgedBy, null);
            assert.equal(
                (await port.readApplied())?.fingerprint,
                'sha256-c',
                'the record moved with the change',
            );

            const listed = await port.listChanges();
            assert.deepEqual(
                listed.map((c) => c.id),
                [second.id, first.id],
            );
            assert.deepEqual(listed[1].previous, SETTINGS);
            assert.equal((listed[1].current as { vatRate: number }).vatRate, 20);

            assert.deepEqual(
                (await port.listChanges({ limit: 1 })).map((c) => c.id),
                [second.id],
            );
        });

        test('a change whose record has moved on is refused whole: no change, and the record as it was', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            await port.writeApplied(applied('sha256-a', FIRST_START), null);
            const refused = await port.recordChange(
                changeTo(TWENTY, SECOND_START),
                applied('sha256-b', SECOND_START, TWENTY),
                'sha256-stale',
            );
            assert.equal(refused, null);
            assert.deepEqual(await port.listChanges(), [], 'no change without its record');
            const read = await port.readApplied();
            assert.equal(read?.fingerprint, 'sha256-a');
            assert.equal(read?.appliedAt.toISOString(), FIRST_START.toISOString());
        });

        test('starts noticing the same difference at once record it once', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            // Several replicas of one deployment start together after one
            // edit: each read 'sha256-a', each found the same difference, and
            // each hands the port the same change. Issued together, so that on
            // a real database they meet on the row rather than queue in the
            // test.
            await port.writeApplied(applied('sha256-a', FIRST_START), null);
            const attempts = await Promise.all(
                [1, 2, 3].map(() =>
                    port.recordChange(
                        changeTo(TWENTY, SECOND_START),
                        applied('sha256-b', SECOND_START, TWENTY),
                        'sha256-a',
                    ),
                ),
            );
            const recorded = attempts.filter((change) => change !== null);
            assert.equal(recorded.length, 1, 'exactly one start records the change');
            assert.deepEqual(
                (await port.listChanges()).map((c) => c.id),
                [recorded[0]?.id],
            );
            assert.equal((await port.readApplied())?.fingerprint, 'sha256-b');
        });

        test('several first starts write the record once', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            const written = await Promise.all(
                [1, 2, 3].map(() => port.writeApplied(applied('sha256-a', FIRST_START), null)),
            );
            assert.equal(written.filter(Boolean).length, 1, 'exactly one start writes it');
            assert.equal((await port.readApplied())?.fingerprint, 'sha256-a');
        });

        test('changes are listed in the order they were recorded, latest first — not by the moment they carry', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            // `noticedAt` is the recording start's own clock. Two starts can
            // read the same millisecond, and a start delayed between its clock
            // and its write can carry a moment earlier than a move that landed
            // before it. Neither decides the order: the database numbers each
            // change at its write, and the list follows that number — the
            // order the record moved in, the same answer every time.
            await port.writeApplied(applied('sha256-0', FIRST_START, {}), null);
            const earlierMove = await port.recordChange(
                changeTo({ vatRate: 1 }, SECOND_START, {}),
                applied('sha256-1', SECOND_START, { vatRate: 1 }),
                'sha256-0',
            );
            // Recorded after the first move, dated before it.
            const laterMove = await port.recordChange(
                changeTo({ vatRate: 2 }, FIRST_START, { vatRate: 1 }),
                applied('sha256-2', FIRST_START, { vatRate: 2 }),
                'sha256-1',
            );
            assert.ok(earlierMove && laterMove, 'both guards held');
            assert.deepEqual(
                (await port.listChanges()).map((c) => c.id),
                [laterMove.id, earlierMove.id],
            );
            assert.deepEqual(
                (await port.listChanges({ limit: 1 })).map((c) => c.id),
                [laterMove.id],
            );
            assert.deepEqual(
                (await port.listChanges()).map((c) => c.id),
                [laterMove.id, earlierMove.id],
                'the same order the second time it is asked',
            );
        });

        test('acknowledging a change is recorded once, and filters it out of what is owed', async (t) => {
            const port = harness.adapter.appliedSettings;
            if (!port) {
                missing(t, 'appliedSettings');
                return;
            }
            await port.writeApplied(applied('sha256-a', FIRST_START), null);
            const change = await port.recordChange(
                changeTo(TWENTY, FIRST_START),
                applied('sha256-b', FIRST_START, TWENTY),
                'sha256-a',
            );
            const open = await port.recordChange(
                changeTo(TWENTY_ONE, SECOND_START, TWENTY),
                applied('sha256-c', SECOND_START, TWENTY_ONE),
                'sha256-b',
            );
            assert.ok(change && open, 'both guards held');

            const seenAt = new Date('2026-09-03T08:00:00.000Z');
            const acknowledged = await port.acknowledgeChange(
                change.id,
                'web:ops@example.com:s1',
                seenAt,
            );
            assert.equal(acknowledged?.acknowledgedAt?.toISOString(), seenAt.toISOString());
            assert.equal(acknowledged?.acknowledgedBy, 'web:ops@example.com:s1');

            // A second acknowledgement keeps the first: who saw it first is the
            // fact, and a later click must not rewrite it.
            const again = await port.acknowledgeChange(
                change.id,
                'web:other@example.com:s2',
                new Date('2026-09-04T08:00:00.000Z'),
            );
            assert.equal(again?.acknowledgedAt?.toISOString(), seenAt.toISOString());
            assert.equal(again?.acknowledgedBy, 'web:ops@example.com:s1');

            assert.deepEqual(
                (await port.listChanges({ acknowledged: false })).map((c) => c.id),
                [open.id],
            );
            assert.deepEqual(
                (await port.listChanges({ acknowledged: true })).map((c) => c.id),
                [change.id],
            );
            assert.equal(
                await port.acknowledgeChange('no-such-change', 'web:ops@example.com:s1', seenAt),
                null,
            );
        });

        // -------------------------------------------------------------
        // Maintenance windows — at most one open, and every move guarded
        // -------------------------------------------------------------

        const ANNOUNCED_AT = new Date('2026-10-01T09:15:00.123Z');
        const WINDOW_STARTS = new Date('2026-10-02T20:00:00.000Z');
        const WINDOW_ENDS = new Date('2026-10-02T21:00:00.000Z');
        const LOCKED_AT = new Date('2026-10-02T20:03:07.456Z');
        const UNLOCKED_AT = new Date('2026-10-02T21:20:00.789Z');
        const OPERATOR = 'web:ops@example.com:s1';
        const announcement = (
            overrides: Partial<NewMaintenanceWindow> = {},
        ): NewMaintenanceWindow => ({
            startsAt: WINDOW_STARTS,
            endsAt: WINDOW_ENDS,
            message: 'Upgrade to 2.3',
            createdAt: ANNOUNCED_AT,
            createdBy: OPERATOR,
            lockedAt: null,
            lockedBy: null,
            ...overrides,
        });

        test('no window is open before one is announced', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            assert.equal(await port.findOpen(), null);
            assert.deepEqual(await port.listRecent(10), []);
        });

        test('an announced window comes back as written, and is the open one', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            const opened = await port.open(announcement());
            assert.ok(opened?.id, 'the adapter assigns the id');
            const open = await port.findOpen();
            assert.equal(open?.id, opened.id);
            assert.equal(open?.startsAt?.toISOString(), WINDOW_STARTS.toISOString());
            assert.equal(open?.endsAt?.toISOString(), WINDOW_ENDS.toISOString());
            // To the millisecond: the moment an operator announced is what the
            // record answers "when were they told" with.
            assert.equal(open?.createdAt.toISOString(), ANNOUNCED_AT.toISOString());
            assert.equal(open?.createdBy, OPERATOR);
            assert.equal(open?.message, 'Upgrade to 2.3');
            assert.equal(open?.lockedAt, null);
            assert.equal(open?.lockedBy, null);
            assert.equal(open?.endedAt, null);
            assert.equal(open?.endedBy, null);
        });

        test('a window locked at once keeps its missing announcement as null, not as an empty value', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            await port.open(
                announcement({
                    startsAt: null,
                    endsAt: null,
                    message: null,
                    lockedAt: LOCKED_AT,
                    lockedBy: 'cli:ops@example.com:deploy-host',
                }),
            );
            const open = await port.findOpen();
            assert.equal(open?.startsAt, null);
            assert.equal(open?.endsAt, null);
            assert.equal(open?.message, null);
            assert.equal(open?.lockedAt?.toISOString(), LOCKED_AT.toISOString());
            assert.equal(open?.lockedBy, 'cli:ops@example.com:deploy-host');
        });

        test('a second window is refused while one is open, and the first stands', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            const first = await port.open(announcement());
            assert.equal(await port.open(announcement({ message: 'the second' })), null);
            assert.equal((await port.findOpen())?.id, first?.id);
            assert.equal((await port.listRecent(10)).length, 1);
        });

        test('of several windows opened at once, exactly one lands', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            // Two operators — or a deploy script and an operator — locking at
            // the same moment. Issued together, so on a real database they meet
            // on the index rather than queue in the test.
            const opened = await Promise.all(
                [1, 2, 3].map((n) => port.open(announcement({ message: `attempt ${n}` }))),
            );
            const landed = opened.filter((window) => window !== null);
            assert.equal(landed.length, 1, 'exactly one window is open');
            assert.equal((await port.findOpen())?.id, landed[0]?.id);
        });

        test('a move names the stage it expects, and a window at another stage is left as it was', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            const window = await port.open(announcement());
            assert.ok(window);
            // Expecting a lock that is not there: nothing moves.
            assert.equal(await port.update(window.id, 'locked', { endedAt: UNLOCKED_AT }), null);
            assert.equal((await port.findOpen())?.endedAt, null);

            const locked = await port.update(window.id, 'announced', {
                lockedAt: LOCKED_AT,
                lockedBy: OPERATOR,
            });
            assert.equal(locked?.lockedAt?.toISOString(), LOCKED_AT.toISOString());
            assert.equal(locked?.lockedBy, OPERATOR);
            assert.equal(locked?.message, 'Upgrade to 2.3', 'what the change did not name is kept');

            // Locked now: a move that still expects the announcement is refused.
            assert.equal(
                await port.update(window.id, 'announced', { startsAt: UNLOCKED_AT }),
                null,
            );
            assert.equal(
                (await port.findOpen())?.startsAt?.toISOString(),
                WINDOW_STARTS.toISOString(),
            );
            assert.equal(await port.update('no-such-window', 'announced', { message: 'x' }), null);
        });

        test('of two locks issued at once, exactly one moves the window', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            const window = await port.open(announcement());
            assert.ok(window);
            const attempts = await Promise.all(
                ['web:a@example.com:s1', 'cli:b@example.com:host'].map((actor) =>
                    port.update(window.id, 'announced', { lockedAt: LOCKED_AT, lockedBy: actor }),
                ),
            );
            const moved = attempts.filter((result) => result !== null);
            assert.equal(moved.length, 1, 'exactly one lock lands');
            assert.equal((await port.findOpen())?.lockedBy, moved[0]?.lockedBy);
        });

        test('an ended window is no longer open, cannot be moved, and makes room for the next', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            const window = await port.open(announcement());
            assert.ok(window);
            await port.update(window.id, 'announced', { lockedAt: LOCKED_AT, lockedBy: OPERATOR });
            const ended = await port.update(window.id, 'locked', {
                endedAt: UNLOCKED_AT,
                endedBy: OPERATOR,
            });
            assert.equal(ended?.endedAt?.toISOString(), UNLOCKED_AT.toISOString());
            assert.equal(ended?.endedBy, OPERATOR);
            assert.equal(await port.findOpen(), null);

            assert.equal(await port.update(window.id, 'locked', { endedAt: new Date() }), null);
            assert.equal(
                (await port.listRecent(1))[0]?.endedAt?.toISOString(),
                UNLOCKED_AT.toISOString(),
                'unlocking again leaves the first end in place',
            );

            const next = await port.open(announcement({ createdAt: UNLOCKED_AT }));
            assert.ok(next, 'the next window opens once the last one ended');
            assert.equal((await port.findOpen())?.id, next.id);
        });

        test('recent windows are listed newest first, the ended ones included, up to the limit', async (t) => {
            const port = harness.adapter.maintenanceWindows;
            if (!port) {
                missing(t, 'maintenanceWindows');
                return;
            }
            const ids: string[] = [];
            for (const [index, day] of ['01', '02', '03'].entries()) {
                const created = new Date(`2026-10-${day}T08:00:00.000Z`);
                const window = await port.open(announcement({ createdAt: created }));
                assert.ok(window);
                ids.push(window.id);
                if (index < 2) {
                    await port.update(window.id, 'announced', {
                        endedAt: created,
                        endedBy: OPERATOR,
                    });
                }
            }
            assert.deepEqual(
                (await port.listRecent(10)).map((w) => w.id),
                [...ids].reverse(),
            );
            assert.deepEqual(
                (await port.listRecent(2)).map((w) => w.id),
                [ids[2], ids[1]],
            );
        });

        // -------------------------------------------------------------
        // Subscriber notices — recorded once, claimed by one run at a time
        // -------------------------------------------------------------

        // @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
        describe('the record of what a subscriber was told', () => {
            const RUN_AT = new Date('2026-10-15T09:00:00.123Z');
            const LATER = new Date('2026-10-15T09:20:00.456Z');
            const LEASE_START = new Date('2026-10-15T08:45:00.000Z');
            const NOTICE: SubscriptionNoticeKey = {
                tenantId: 'tenant-told',
                subscriptionId: 'sub-told',
                kind: 'version-offered',
                subject: 'pv-standard-2',
            };
            const CONTENT = { kind: 'version-offered', offer: { plan: 'STANDARD', version: 2 } };
            const DELIVERY = {
                recipients: ['admin@example.com', 'owner@example.com'],
                channel: 'email',
            };

            /** A scenario of the record, skipped where the harness declares it has none. */
            function scenario(
                name: string,
                body: (notices: SubscriptionNoticeRepository) => Promise<void>,
            ): void {
                test(name, async (t) => {
                    const notices = harness.adapter.subscriptionNotices;
                    if (!notices) {
                        missing(t, 'subscriptionNotices');
                        return;
                    }
                    await body(notices);
                });
            }

            scenario('the first run records the notice and holds it', async (notices) => {
                const claimed = await notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START);
                assert.ok(claimed?.id, 'the adapter assigns the id');
                assert.equal(claimed.tenantId, 'tenant-told');
                assert.equal(claimed.subscriptionId, 'sub-told');
                assert.equal(claimed.kind, 'version-offered');
                assert.equal(claimed.subject, 'pv-standard-2');
                assert.deepEqual(claimed.content, CONTENT);
                assert.equal(claimed.createdAt.toISOString(), RUN_AT.toISOString());
                assert.equal(claimed.claimedAt?.toISOString(), RUN_AT.toISOString());
                assert.equal(claimed.deliveredAt, null);
                assert.equal(claimed.delivery, null);
            });

            scenario(
                'a run finds a notice another run holds, and takes it on once that claim is stale',
                async (notices) => {
                    const first = await notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START);
                    assert.equal(
                        await notices.claim(NOTICE, CONTENT, LATER, LEASE_START),
                        null,
                        'held since after the lease started: not taken',
                    );
                    const staleBefore = new Date(RUN_AT.getTime() + 1);
                    const second = await notices.claim(
                        NOTICE,
                        { changed: true },
                        LATER,
                        staleBefore,
                    );
                    assert.equal(second?.id, first?.id, 'one notice, not a second');
                    assert.equal(second?.claimedAt?.toISOString(), LATER.toISOString());
                    assert.deepEqual(
                        second?.content,
                        { changed: true },
                        'the claim stores what is sent now',
                    );
                },
            );

            scenario(
                'of several runs claiming one notice at the same moment, exactly one holds it',
                async (notices) => {
                    const claims = await Promise.all(
                        Array.from({ length: 4 }, () =>
                            notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START),
                        ),
                    );
                    assert.equal(claims.filter((claim) => claim !== null).length, 1);
                    assert.equal((await notices.listForSubscription('sub-told')).length, 1);
                },
            );

            scenario(
                'a confirmed notice keeps to whom and how, and is never claimed again',
                async (notices) => {
                    const claimed = await notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START);
                    assert.ok(claimed?.claimedAt);
                    assert.equal(
                        await notices.confirm(claimed.id, claimed.claimedAt, DELIVERY, LATER),
                        true,
                    );
                    const [kept] = await notices.listForSubscription('sub-told');
                    assert.equal(kept?.deliveredAt?.toISOString(), LATER.toISOString());
                    assert.deepEqual(kept?.delivery, DELIVERY);
                    assert.deepEqual(
                        await notices.listDeliveredSubscriptionIds(
                            'version-offered',
                            'pv-standard-2',
                        ),
                        ['sub-told'],
                    );
                    const farFuture = new Date('2099-01-01T00:00:00.000Z');
                    assert.equal(await notices.claim(NOTICE, CONTENT, farFuture, farFuture), null);
                },
            );

            scenario('a notice told to nobody is kept as delivered to no one', async (notices) => {
                const claimed = await notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START);
                assert.ok(claimed?.claimedAt);
                const nobody = { recipients: [], channel: 'email' };
                assert.equal(
                    await notices.confirm(claimed.id, claimed.claimedAt, nobody, LATER),
                    true,
                );
                assert.deepEqual(
                    (await notices.listForSubscription('sub-told'))[0]?.delivery,
                    nobody,
                );
            });

            scenario(
                'a confirmation from a claim another run has since taken over is refused',
                async (notices) => {
                    const first = await notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START);
                    const second = await notices.claim(
                        NOTICE,
                        CONTENT,
                        LATER,
                        new Date(RUN_AT.getTime() + 1),
                    );
                    assert.ok(first?.claimedAt && second?.claimedAt);
                    assert.equal(
                        await notices.confirm(first.id, first.claimedAt, DELIVERY, LATER),
                        false,
                    );
                    assert.equal(
                        (await notices.listForSubscription('sub-told'))[0]?.deliveredAt,
                        null,
                    );
                    assert.equal(
                        await notices.confirm(second.id, second.claimedAt, DELIVERY, LATER),
                        true,
                    );
                },
            );

            scenario(
                'a released notice is taken on by the next run, and only its own claim releases it',
                async (notices) => {
                    const claimed = await notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START);
                    assert.ok(claimed?.claimedAt);
                    await notices.release(claimed.id, LATER);
                    assert.equal(
                        await notices.claim(NOTICE, CONTENT, LATER, LEASE_START),
                        null,
                        'another moment is not this claim: still held',
                    );
                    await notices.release(claimed.id, claimed.claimedAt);
                    const again = await notices.claim(NOTICE, CONTENT, LATER, LEASE_START);
                    assert.equal(again?.id, claimed.id);
                    assert.equal(again?.claimedAt?.toISOString(), LATER.toISOString());
                },
            );

            scenario(
                'notices are kept apart by subscription, kind and subject, the most recent first',
                async (notices) => {
                    const v2 = await notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START);
                    const v3 = await notices.claim(
                        { ...NOTICE, subject: 'pv-standard-3' },
                        CONTENT,
                        LATER,
                        LEASE_START,
                    );
                    const other = await notices.claim(
                        { ...NOTICE, tenantId: 'tenant-other', subscriptionId: 'sub-other' },
                        CONTENT,
                        RUN_AT,
                        LEASE_START,
                    );
                    assert.ok(v2?.claimedAt && v3?.claimedAt && other?.claimedAt);
                    await notices.confirm(other.id, other.claimedAt, DELIVERY, LATER);
                    assert.deepEqual(
                        (await notices.listForSubscription('sub-told')).map(
                            (notice) => notice.subject,
                        ),
                        ['pv-standard-3', 'pv-standard-2'],
                    );
                    assert.deepEqual(
                        await notices.listDeliveredSubscriptionIds(
                            'version-offered',
                            'pv-standard-2',
                        ),
                        ['sub-other'],
                        'only what was delivered, and only for that subject',
                    );
                },
            );

            scenario(
                'a notice recorded ahead of telling is unclaimed, and one recorded already is left as it was',
                async (notices) => {
                    const claimed = await notices.claim(NOTICE, CONTENT, RUN_AT, LEASE_START);
                    const written = await notices.record(
                        [
                            { ...NOTICE, content: { overwritten: true } },
                            { ...NOTICE, subscriptionId: 'sub-new', content: CONTENT },
                        ],
                        LATER,
                    );
                    const [kept] = await notices.listForSubscription('sub-told');
                    assert.deepEqual(kept?.content, CONTENT, 'not overwritten');
                    assert.equal(
                        kept?.claimedAt?.toISOString(),
                        claimed?.claimedAt?.toISOString(),
                        'and its claim not touched',
                    );
                    assert.equal(written, 1, 'only the notice it recorded now is counted');
                    assert.equal(await notices.record([], LATER), 0, 'nothing to record');
                    const [fresh] = await notices.listForSubscription('sub-new');
                    assert.equal(fresh?.createdAt.toISOString(), LATER.toISOString());
                    assert.equal(fresh?.claimedAt, null);
                    assert.equal(fresh?.deliveredAt, null);
                },
            );

            scenario(
                'a kind is read from an instant on, the most recent first',
                async (notices) => {
                    const EARLY = new Date('2026-10-01T00:00:00.000Z');
                    const retired = (subject: string): NoticeToRecord => ({
                        ...NOTICE,
                        kind: 'version-retired',
                        subject,
                        content: CONTENT,
                    });
                    await notices.record([retired('ret-1')], EARLY);
                    await notices.record([retired('ret-2')], RUN_AT);
                    await notices.record([{ ...NOTICE, subject: 'pv-x', content: CONTENT }], LATER);
                    assert.deepEqual(
                        (
                            await notices.listOfKindSince(
                                'version-retired',
                                new Date('2026-10-02T00:00:00.000Z'),
                            )
                        ).map((notice) => notice.subject),
                        ['ret-2'],
                    );
                    assert.deepEqual(
                        (await notices.listOfKindSince('version-retired', EARLY)).map(
                            (notice) => notice.subject,
                        ),
                        ['ret-2', 'ret-1'],
                        'from the instant itself on, the most recent first, and of that kind only',
                    );
                },
            );

            scenario(
                'the notices nobody delivers are listed, the oldest first, a held one once its claim is stale',
                async (notices) => {
                    const retired = (subject: string): NoticeToRecord => ({
                        ...NOTICE,
                        kind: 'version-retired',
                        subject,
                        content: CONTENT,
                    });
                    await notices.record([retired('a')], LEASE_START);
                    await notices.record([retired('b'), retired('c'), retired('d')], RUN_AT);
                    await notices.record(
                        [{ ...NOTICE, subject: 'offered', content: CONTENT }],
                        LEASE_START,
                    );
                    await notices.claim(retired('b'), CONTENT, LATER, LEASE_START);
                    await notices.claim(retired('c'), CONTENT, RUN_AT, LEASE_START);
                    const d = await notices.claim(retired('d'), CONTENT, RUN_AT, LEASE_START);
                    assert.ok(d?.claimedAt);
                    await notices.confirm(d.id, d.claimedAt, DELIVERY, LATER);
                    const staleBefore = new Date(RUN_AT.getTime() + 1);
                    assert.deepEqual(
                        (await notices.listUndelivered('version-retired', staleBefore)).map(
                            (notice) => notice.subject,
                        ),
                        ['a', 'c'],
                        'never claimed, and claimed before the lease started; not the fresh claim, ' +
                            'not the delivered one, not another kind',
                    );
                },
            );
        });

        // -------------------------------------------------------------
        // Retirement announcements — written with the notices they make
        // -------------------------------------------------------------

        describe('a retirement announcement', () => {
            const ANNOUNCED_AT = new Date('2026-03-15T10:30:00.250Z');
            const ANNOUNCEMENT: NewVersionRetirement = {
                retired: { planVersionId: 'pv-basic-1', planKey: 'BASIC', version: 1 },
                replacement: { planVersionId: 'pv-standard-3', planKey: 'STANDARD', version: 3 },
                announcedAt: ANNOUNCED_AT,
                announcedBy: 'super-admin:ops@example.com',
            };
            const noticeOf = (retirementId: string): NoticeToRecord => ({
                tenantId: 'tenant-retired',
                subscriptionId: 'sub-retired',
                kind: 'version-retired',
                subject: retirementId,
                content: { retirementId },
            });

            /** A scenario of the announcement, skipped where the harness declares it has none. */
            function scenario(
                name: string,
                body: (
                    retirements: VersionRetirementRepository,
                    notices: SubscriptionNoticeRepository,
                ) => Promise<void>,
            ): void {
                test(name, async (t) => {
                    const retirements = harness.adapter.versionRetirements;
                    if (!retirements) {
                        missing(t, 'versionRetirements');
                        return;
                    }
                    const notices = harness.adapter.subscriptionNotices;
                    if (!notices) {
                        missing(t, 'subscriptionNotices');
                        return;
                    }
                    await body(retirements, notices);
                });
            }

            scenario('is kept with both versions, when and by whom', async (retirements) => {
                const created = await retirements.create(ANNOUNCEMENT);
                assert.ok(created.id, 'the adapter assigns the id');
                assert.deepEqual(created.retired, ANNOUNCEMENT.retired);
                assert.deepEqual(created.replacement, ANNOUNCEMENT.replacement);
                assert.equal(created.announcedAt.toISOString(), ANNOUNCED_AT.toISOString());
                assert.equal(created.announcedBy, ANNOUNCEMENT.announcedBy);
                assert.deepEqual(await retirements.findById(created.id), created);
                assert.equal(await retirements.findById('no-such-retirement'), null);
            });

            scenario('is listed with the most recent first', async (retirements) => {
                const first = await retirements.create(ANNOUNCEMENT);
                const second = await retirements.create({
                    ...ANNOUNCEMENT,
                    announcedAt: new Date('2026-04-01T00:00:00.000Z'),
                });
                assert.deepEqual(
                    (await retirements.list()).map((retirement) => retirement.id),
                    [second.id, first.id],
                );
            });

            scenario(
                'is written with its notices in one transaction, or not at all',
                async (retirements, notices) => {
                    await assert.rejects(
                        harness.adapter.transactionRunner.run(async (tx) => {
                            const retirement = await retirements.create(ANNOUNCEMENT, tx);
                            await notices.record([noticeOf(retirement.id)], ANNOUNCED_AT, tx);
                            throw new Error('rolled back');
                        }),
                        /rolled back/,
                    );
                    assert.deepEqual(await retirements.list(), [], 'no announcement');
                    assert.deepEqual(
                        await notices.listForSubscription('sub-retired'),
                        [],
                        'and no notice',
                    );

                    const kept = await harness.adapter.transactionRunner.run(async (tx) => {
                        const retirement = await retirements.create(ANNOUNCEMENT, tx);
                        await notices.record([noticeOf(retirement.id)], ANNOUNCED_AT, tx);
                        return retirement;
                    });
                    const [notice] = await notices.listForSubscription('sub-retired');
                    assert.equal(notice?.subject, kept.id);
                    assert.equal(notice?.kind, 'version-retired');
                    assert.equal(notice?.claimedAt, null, 'recorded, not yet told');
                },
            );
        });

        describe('the subscriptions on one version', () => {
            test('are listed in every tenant, whatever their status, and none of another version', async (t) => {
                const usage = harness.adapter.subscriptionUsage;
                if (!usage?.listBoundToVersion) {
                    missing(t, 'boundSubscriptions');
                    return;
                }
                const { seed } = harness;
                const v1 = await seed.createPlanVersion({
                    planKey: 'RETIRE',
                    version: 1,
                    quotas: {},
                    features: [],
                    published: true,
                    superseded: true,
                });
                const v2 = await seed.createPlanVersion({
                    planKey: 'RETIRE',
                    version: 2,
                    quotas: {},
                    features: [],
                    published: true,
                });
                // A has taken version 2 for the end of its term: still on 1,
                // and the version it moves to read with it.
                const a = await seed.createSubscription({
                    tenantId: 'tenant-a',
                    plan: 'RETIRE',
                    planVersionId: v1.planVersionId,
                    pendingChangeVersionId: v2.planVersionId,
                });
                const b = await seed.createSubscription({
                    tenantId: 'tenant-b',
                    plan: 'RETIRE',
                    planVersionId: v1.planVersionId,
                    status: 'CANCELED',
                });
                await seed.createSubscription({
                    tenantId: 'tenant-c',
                    plan: 'RETIRE',
                    planVersionId: v2.planVersionId,
                });
                const bound = await usage.listBoundToVersion(v1.planVersionId);
                assert.deepEqual(
                    bound.map((row) => `${row.tenantId}/${row.subscription.id}`).sort(),
                    [`tenant-a/${a.subscriptionId}`, `tenant-b/${b.subscriptionId}`].sort(),
                );
                assert.ok(
                    bound.every((row) => row.subscription.planVersion.id === v1.planVersionId),
                    'each read with the version it is on',
                );
                const pending = Object.fromEntries(
                    bound.map((row) => [
                        row.subscription.id,
                        row.subscription.pendingChangeVersionId ?? null,
                    ]),
                );
                assert.deepEqual(
                    pending,
                    { [a.subscriptionId]: v2.planVersionId, [b.subscriptionId]: null },
                    'and the version a scheduled change binds',
                );
                assert.deepEqual(await usage.listBoundToVersion('no-such-version'), []);
            });
        });

        describe('an add-on retirement announcement', () => {
            const ANNOUNCED_AT = new Date('2026-03-15T10:30:00.250Z');
            const ANNOUNCEMENT: NewBundleVersionRetirement = {
                retired: { bundleVersionId: 'bv-reports-1', bundleKey: 'REPORTS', version: 1 },
                replacement: { bundleVersionId: 'bv-reports-2', bundleKey: 'REPORTS', version: 2 },
                announcedAt: ANNOUNCED_AT,
                announcedBy: 'super-admin:ops@example.com',
            };
            const noticeOf = (retirementId: string): NoticeToRecord => ({
                tenantId: 'tenant-add-on-retired',
                subscriptionId: 'sub-add-on-retired',
                kind: 'bundle-version-retired',
                subject: 'bv-reports-1',
                content: { retirementId },
            });

            /** A scenario of the announcement, skipped where the harness declares it has none. */
            function scenario(
                name: string,
                body: (
                    retirements: BundleVersionRetirementRepository,
                    notices: SubscriptionNoticeRepository,
                ) => Promise<void>,
            ): void {
                test(name, async (t) => {
                    const retirements = harness.adapter.bundleVersionRetirements;
                    if (!retirements) {
                        missing(t, 'bundleVersionRetirements');
                        return;
                    }
                    const notices = harness.adapter.subscriptionNotices;
                    if (!notices) {
                        missing(t, 'subscriptionNotices');
                        return;
                    }
                    await body(retirements, notices);
                });
            }

            scenario('is kept with both versions, when and by whom', async (retirements) => {
                const created = await retirements.create(ANNOUNCEMENT);
                assert.ok(created.id, 'the adapter assigns the id');
                assert.deepEqual(created.retired, ANNOUNCEMENT.retired);
                assert.deepEqual(created.replacement, ANNOUNCEMENT.replacement);
                assert.equal(created.announcedAt.toISOString(), ANNOUNCED_AT.toISOString());
                assert.equal(created.announcedBy, ANNOUNCEMENT.announcedBy);
                assert.deepEqual(await retirements.findById(created.id), created);
                assert.equal(await retirements.findById('no-such-retirement'), null);
            });

            scenario('is listed with the most recent first', async (retirements) => {
                const first = await retirements.create(ANNOUNCEMENT);
                const second = await retirements.create({
                    ...ANNOUNCEMENT,
                    announcedAt: new Date('2026-04-01T00:00:00.000Z'),
                });
                assert.deepEqual(
                    (await retirements.list()).map((retirement) => retirement.id),
                    [second.id, first.id],
                );
            });

            scenario(
                'is written with its notices in one transaction, or not at all',
                async (retirements, notices) => {
                    await assert.rejects(
                        harness.adapter.transactionRunner.run(async (tx) => {
                            const retirement = await retirements.create(ANNOUNCEMENT, tx);
                            await notices.record([noticeOf(retirement.id)], ANNOUNCED_AT, tx);
                            throw new Error('rolled back');
                        }),
                        /rolled back/,
                    );
                    assert.deepEqual(await retirements.list(), [], 'no announcement');
                    assert.deepEqual(
                        await notices.listForSubscription('sub-add-on-retired'),
                        [],
                        'and no notice',
                    );

                    const kept = await harness.adapter.transactionRunner.run(async (tx) => {
                        const retirement = await retirements.create(ANNOUNCEMENT, tx);
                        await notices.record([noticeOf(retirement.id)], ANNOUNCED_AT, tx);
                        return retirement;
                    });
                    const [notice] = await notices.listForSubscription('sub-add-on-retired');
                    assert.equal(notice?.kind, 'bundle-version-retired');
                    assert.deepEqual(notice?.content, { retirementId: kept.id });
                    assert.equal(notice?.claimedAt, null, 'recorded, not yet told');
                },
            );
        });

        describe('the bookings of one add-on version', () => {
            test('are listed in every tenant, whatever their state, and none of another version', async (t) => {
                const repository = harness.adapter.subscriptionBundleRepository;
                const { seed } = harness;
                if (!repository?.listOfVersion || !seed.createBundleVersion) {
                    missing(t, 'bookingsOfVersion');
                    return;
                }
                const { planVersionId } = await seed.createPlanVersion({
                    planKey: 'RETIRE_ADD_ON',
                    version: 1,
                    quotas: {},
                    features: [],
                    published: true,
                });
                const v1 = await seed.createBundleVersion({
                    bundleKey: 'RETIRING',
                    features: ['REPORTS'],
                });
                const v2 = await seed.createBundleVersion({
                    bundleKey: 'OTHER_ADD_ON',
                    features: ['EXPORTS'],
                });
                const bookingIn = async (tenantId: string, bundleVersionId: string) => {
                    const { subscriptionId } = await seed.createSubscription({
                        tenantId,
                        plan: 'RETIRE_ADD_ON',
                        planVersionId,
                    });
                    return repository.add({
                        subscriptionId,
                        bundleVersionId,
                        startedAt: new Date('2026-02-01T00:00:00.000Z'),
                        minimumTermEndsAt: null,
                    });
                };
                const running = await bookingIn('tenant-a', v1.bundleVersionId);
                const cancelled = await bookingIn('tenant-b', v1.bundleVersionId);
                await repository.cancel(cancelled.id, {
                    canceledAt: new Date('2026-02-10T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-03-01T00:00:00.000Z'),
                });
                await bookingIn('tenant-c', v2.bundleVersionId);

                const listed = await repository.listOfVersion(v1.bundleVersionId);
                assert.deepEqual(
                    listed.map((booking) => booking.id).sort(),
                    [running.id, cancelled.id].sort(),
                );
                assert.ok(
                    listed.every((booking) => booking.bundleVersionId === v1.bundleVersionId),
                    'each read with the version it is on',
                );
                assert.equal(
                    listed
                        .find((booking) => booking.id === cancelled.id)
                        ?.canceledEffectiveAt?.toISOString(),
                    '2026-03-01T00:00:00.000Z',
                    'and a cancellation as it stands',
                );
                assert.deepEqual(await repository.listOfVersion(NO_SUCH_VERSION), []);
            });
        });

        describe('a booking moved to another add-on version', () => {
            test('takes the version, keeps everything else, and only while it is on the one named', async (t) => {
                const repository = harness.adapter.subscriptionBundleRepository;
                const { seed } = harness;
                if (!repository?.moveToVersion || !seed.createBundleVersion) {
                    missing(t, 'bookingsMoved');
                    return;
                }
                const { planVersionId } = await seed.createPlanVersion({
                    planKey: 'MOVE_ADD_ON',
                    version: 1,
                    quotas: {},
                    features: [],
                    published: true,
                });
                const retired = await seed.createBundleVersion({
                    bundleKey: 'MOVED_FROM',
                    features: ['REPORTS'],
                });
                const replacement = await seed.createBundleVersion({
                    bundleKey: 'MOVED_TO',
                    features: ['REPORTS'],
                });
                const { subscriptionId } = await seed.createSubscription({
                    tenantId: 'tenant-moved',
                    plan: 'MOVE_ADD_ON',
                    planVersionId,
                });
                const booked = await repository.add({
                    subscriptionId,
                    bundleVersionId: retired.bundleVersionId,
                    startedAt: new Date('2026-02-01T00:00:00.000Z'),
                    minimumTermEndsAt: new Date('2027-02-01T00:00:00.000Z'),
                    billingCycle: 'MONTHLY',
                    currentPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
                    currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
                });
                const cancelled = await repository.cancel(booked.id, {
                    canceledAt: new Date('2026-03-10T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2027-02-01T00:00:00.000Z'),
                });

                const moved = await repository.moveToVersion(
                    booked.id,
                    retired.bundleVersionId,
                    replacement.bundleVersionId,
                );

                assert.ok(moved, 'the booking is moved');
                assert.equal(moved.bundleVersionId, replacement.bundleVersionId);
                /** A booking without its version and the moment it was last written. */
                const unmoved = ({
                    bundleVersionId: _version,
                    updatedAt: _written,
                    ...rest
                }: typeof cancelled) => rest;
                assert.deepEqual(
                    unmoved(moved),
                    unmoved(cancelled),
                    'its period, terms, rhythm and cancellation',
                );
                assert.equal(
                    (await repository.findById(booked.id))?.bundleVersionId,
                    replacement.bundleVersionId,
                    'and read so afterwards',
                );
                assert.equal(
                    await repository.moveToVersion(
                        booked.id,
                        retired.bundleVersionId,
                        replacement.bundleVersionId,
                    ),
                    null,
                    'a second move from the version it has left claims nothing',
                );
                assert.equal(
                    (
                        await repository.moveToVersion(
                            booked.id,
                            replacement.bundleVersionId,
                            retired.bundleVersionId,
                        )
                    )?.bundleVersionId,
                    retired.bundleVersionId,
                    'and a put-back from where it now is takes it back',
                );
                assert.equal(
                    await repository.moveToVersion(
                        NO_SUCH_BOOKING,
                        retired.bundleVersionId,
                        replacement.bundleVersionId,
                    ),
                    null,
                );
            });
        });

        describe('subscriptions read by id', () => {
            test('are each read with the tenant they belong to, and an unknown id is left out', async (t) => {
                const usage = harness.adapter.subscriptionUsage;
                if (!usage?.listByIds) {
                    missing(t, 'subscriptionsById');
                    return;
                }
                const { seed } = harness;
                const { planVersionId } = await seed.createPlanVersion({
                    planKey: 'BY_ID',
                    version: 1,
                    quotas: {},
                    features: [],
                    published: true,
                });
                const a = await seed.createSubscription({
                    tenantId: 'tenant-by-id-a',
                    plan: 'BY_ID',
                    planVersionId,
                });
                const b = await seed.createSubscription({
                    tenantId: 'tenant-by-id-b',
                    plan: 'BY_ID',
                    planVersionId,
                    status: 'CANCELED',
                });
                await seed.createSubscription({
                    tenantId: 'tenant-by-id-c',
                    plan: 'BY_ID',
                    planVersionId,
                });

                const read = await usage.listByIds([
                    b.subscriptionId,
                    a.subscriptionId,
                    'no-such-subscription',
                ]);
                assert.deepEqual(
                    read.map((row) => `${row.tenantId}/${row.subscription.id}`).sort(),
                    [
                        `tenant-by-id-a/${a.subscriptionId}`,
                        `tenant-by-id-b/${b.subscriptionId}`,
                    ].sort(),
                );
                assert.ok(
                    read.every((row) => row.subscription.planVersion?.id === planVersionId),
                    'each read with the version it is on',
                );
                assert.deepEqual(await usage.listByIds([]), []);
            });
        });
    });
}
