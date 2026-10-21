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
    NewSubscriptionInvoice,
    SubscriberChargeRecord,
    SubscriptionInvoicePayment,
    NewInvoiceCollection,
    InvoiceCollectionRecord,
    NewSubscriberPayment,
    NewSubscriberPayout,
    PlannedInvoiceCollection,
    ReportedSubscriberRefund,
    ReportedSubscriberReversal,
    SubscriberPaymentRepository,
    TaxTreatment,
    VatIdCheck,
    NewVersionRetirement,
    NoticeToRecord,
    SubscriptionNoticeKey,
    SubscriptionNoticeRepository,
    TransactionContext,
    VersionRetirementRepository,
    BundleVersionRetirementRepository,
    FeatureWithdrawalRepository,
    NewFeatureWithdrawal,
} from '@saasicat/core';
import {
    BILLING_ERROR_CODES,
    CATALOG_ERROR_CODES,
    CONTRACT_ERROR_CODES,
    INVOICE_ERROR_CODES,
    PROMO_ERROR_CODES,
    collectionAttemptKey,
    counterEntryOf,
    draftCancellationInvoice,
    draftCorrectedReplacementInvoice,
    draftReplacementInvoice,
    isPersistenceRefusal,
    lineCorrectionsOf,
    movedPaymentParts,
    paidByShares,
    sumToCents,
    taxPerRate,
    writtenReplacementOf,
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

/** The treatment the invoices of the contract record, unless a scenario names another. */
const INVOICE_TREATMENT: TaxTreatment = {
    kind: 'standard',
    rate: 19,
    note: null,
    adapter: { name: '@saasicat/tax-de', version: '1.0.0-rc.25' },
};

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
    { reason: string; present: (harness: PersistenceContractHarness) => boolean }
> = {
    atomicPlanBinding: {
        reason: 'adapter does not expose atomic plan-binding writes',
        present: ({ adapter }) => Boolean(adapter.tenantSubscriptionWrite),
    },
    atomicOnboarding: {
        reason: 'adapter does not expose atomic onboarding writes',
        present: ({ adapter }) =>
            typeof adapter.tenantSubscriptionWrite?.applyOnboardingSelection === 'function',
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
                typeof repository.terminate === 'function',
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
                typeof repository.findActivePlanVersion === 'function',
            );
        },
    },
    planRetirement: {
        reason: 'adapter provides no PlanRepository that retires and finds plans by key',
        present: ({ adapter }) =>
            Boolean(
                adapter.planRepository?.softDelete &&
                typeof adapter.planRepository.findByKey === 'function',
            ),
    },
    planVersionReads: {
        reason: 'adapter provides no PlanRepository that reads versions by plan key',
        present: ({ adapter }) => {
            const repository = adapter.planRepository;
            return Boolean(
                repository?.listVersions &&
                repository.findCurrentDraft &&
                typeof repository.findLatestLivePlanVersion === 'function',
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
                typeof repository.softDelete === 'function',
            );
        },
    },
    bundleRepository: {
        reason: 'adapter provides no BundleRepository',
        present: ({ adapter }) => Boolean(adapter.bundleRepository),
    },
    bundleValidity: {
        reason: 'adapter provides no time-aware BundleRepository',
        present: ({ adapter }) =>
            typeof adapter.bundleRepository?.findActiveBundleVersion === 'function',
    },
    bundleDraftDiscard: {
        reason: 'adapter provides no BundleRepository that discards drafts',
        present: ({ adapter }) => typeof adapter.bundleRepository?.deleteDraft === 'function',
    },
    bundleDraftPublish: {
        reason: 'adapter provides no BundleRepository that publishes drafts',
        present: ({ adapter }) => typeof adapter.bundleRepository?.publishDraft === 'function',
    },
    planDraftPublish: {
        reason: 'adapter provides no PlanRepository that creates, publishes and reads drafts',
        present: ({ adapter }) => {
            const repository = adapter.planRepository;
            return Boolean(
                repository?.createPlanVersionDraft &&
                repository.publishPlanVersionDraft &&
                typeof repository.findVersionById === 'function',
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
                typeof repository.deletePlanVersionDraft === 'function',
            );
        },
    },
    bundleRetirement: {
        reason: 'adapter provides no BundleRepository that retires and finds bundles by key',
        present: ({ adapter }) =>
            Boolean(
                adapter.bundleRepository?.softDelete &&
                typeof adapter.bundleRepository.findByKey === 'function',
            ),
    },
    bundleBookings: {
        reason: 'adapter provides no SubscriptionBundleRepository or bundle catalog',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriptionBundleRepository &&
                typeof seed.createBundleVersion === 'function',
            ),
    },
    halfCancelledBookingSeed: {
        reason: 'adapter harness cannot write the half-cancelled shape',
        present: ({ seed }) => typeof seed.clearBookingRequestDate === 'function',
    },
    foreignBookingCycleSeed: {
        reason: 'adapter harness cannot write a rhythm the platform never writes',
        present: ({ seed }) => typeof seed.setBookingCycle === 'function',
    },
    countByPlanVersionId: {
        reason: 'adapter does not implement countByPlanVersionId (fail-closed fallback)',
        present: ({ adapter }) =>
            typeof adapter.subscriptionRepository.countByPlanVersionId === 'function',
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
            Boolean(
                adapter.subscriptionContractRepository &&
                typeof seed.createSubscriber === 'function',
            ),
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
            Boolean(
                adapter.subscriberPaymentMethodRepository &&
                typeof seed.createSubscriber === 'function',
            ),
    },
    subscriberLedger: {
        reason: 'adapter provides no SubscriberLedgerRepository, or no contracts and subscriber seed for it',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriberLedgerRepository &&
                adapter.subscriptionContractRepository &&
                typeof seed.createSubscriber === 'function',
            ),
    },
    subscriptionInvoices: {
        reason: 'adapter provides no SubscriptionInvoiceRepository, or no charge journal, contracts and subscriber seed for it',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriptionInvoiceRepository &&
                adapter.subscriberLedgerRepository &&
                adapter.subscriptionContractRepository &&
                typeof seed.createSubscriber === 'function',
            ),
    },
    invoiceArchive: {
        reason: 'adapter provides no InvoiceArchivePort, or nothing an invoice needs before it',
        present: (harness) =>
            Boolean(
                harness.adapter.invoiceArchive &&
                CONTRACT_GAPS.subscriptionInvoices.present(harness),
            ),
    },
    invoiceCollections: {
        reason: 'adapter provides no InvoiceCollectionRepository, or nothing an invoice, a payment method or a payment needs before it',
        present: (harness) =>
            Boolean(
                harness.adapter.invoiceCollectionRepository &&
                // An invoice that owes nothing is collected no further, which
                // the attempts read off what the payments settle.
                harness.adapter.subscriberPaymentRepository &&
                CONTRACT_GAPS.subscriptionInvoices.present(harness) &&
                CONTRACT_GAPS.subscriberPaymentMethods.present(harness),
            ),
    },
    subscriberPayments: {
        reason: 'adapter provides no SubscriberPaymentRepository, or nothing a collection attempt needs before it',
        present: (harness) =>
            Boolean(
                harness.adapter.subscriberPaymentRepository &&
                CONTRACT_GAPS.invoiceCollections.present(harness),
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
        present: ({ adapter }) =>
            typeof adapter.subscriptionUsage?.listBoundToVersion === 'function',
    },
    bundleVersionRetirements: {
        reason: 'adapter provides no BundleVersionRetirementRepository',
        present: ({ adapter }) => Boolean(adapter.bundleVersionRetirements),
    },
    bookingsOfVersion: {
        reason: 'adapter provides no SubscriptionBundleRepository that lists an add-on version',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriptionBundleRepository?.listOfVersion &&
                typeof seed.createBundleVersion === 'function',
            ),
    },
    bookingsMoved: {
        reason: 'adapter provides no SubscriptionBundleRepository that moves a booking to another version',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriptionBundleRepository?.moveToVersion &&
                typeof seed.createBundleVersion === 'function',
            ),
    },
    bookingsScheduled: {
        reason: 'adapter provides no SubscriptionBundleRepository that schedules a switch to another version',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriptionBundleRepository?.scheduleVersion &&
                adapter.subscriptionBundleRepository.unscheduleVersion &&
                adapter.subscriptionBundleRepository.listScheduledVersionsDue &&
                typeof seed.createBundleVersion === 'function',
            ),
    },
    subscriptionsById: {
        reason: 'adapter provides no SubscriptionUsagePort that reads subscriptions by id',
        present: ({ adapter }) => typeof adapter.subscriptionUsage?.listByIds === 'function',
    },
    featureWithdrawals: {
        reason: 'adapter provides no FeatureWithdrawalRepository',
        present: ({ adapter }) => Boolean(adapter.featureWithdrawals),
    },
    bookingsEndedNow: {
        reason: 'adapter provides no SubscriptionBundleRepository that ends a cancelled booking at once',
        present: ({ adapter, seed }) =>
            Boolean(
                adapter.subscriptionBundleRepository?.endNow &&
                typeof seed.createBundleVersion === 'function',
            ),
    },
    subscriptionsEndedNow: {
        reason: 'adapter provides no TenantSubscriptionWritePort that ends a cancelled subscription at once',
        present: ({ adapter }) => typeof adapter.tenantSubscriptionWrite?.endNow === 'function',
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
            const setBookingCycle = seed.setBookingCycle?.bind(seed);
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
            const clearRequestDate = harness.seed.clearBookingRequestDate?.bind(harness.seed);
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

        test('a change or a delete reaches a code only while it is not deleted', async (t) => {
            const promoCodes = harness.adapter.promoCodeRepository;
            if (!promoCodes) {
                missing(t, 'promoCodes');
                return;
            }
            const code = await promoCodes.create({
                code: 'DELETED-ONCE',
                valueType: 'PERCENT',
                value: 10,
                durationType: 'ONCE',
                createdById: 'operator-1',
            });

            assert.equal(await promoCodes.softDelete(code.id), true, 'the first delete marks it');
            const deleted = await promoCodes.findById(code.id);
            assert.ok(deleted?.deletedAt, 'and it is deleted');

            // The platform reads a code before it changes it, and the code can
            // be deleted in between: the write itself has to leave it alone.
            assert.equal(
                await promoCodes.softDelete(code.id),
                false,
                'a second delete finds no code to mark',
            );
            assert.equal(
                await promoCodes.update(code.id, { value: 50 }),
                null,
                'a change finds no code to change',
            );
            const after = await promoCodes.findById(code.id);
            // An adapter may hand the moment over as a `Date` or as text; the
            // moment is what has to stay.
            const moment = (value: string | Date | null | undefined) =>
                value == null ? null : new Date(value).getTime();
            assert.equal(
                moment(after?.deletedAt),
                moment(deleted?.deletedAt),
                'the day it was deleted stays',
            );
            assert.equal(Number(after?.value), 10, 'its terms stay');

            assert.equal(await promoCodes.update('no-such-code', { value: 50 }), null);
            assert.equal(await promoCodes.softDelete('no-such-code'), false);
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
                    .sort((a, b) => (a ?? '').localeCompare(b ?? ''));

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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
                    reason: 'Trade register extract handed in',
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
                reason: 'Trade register extract handed in again',
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
                    reason: change.reason,
                })),
                [
                    {
                        subscriberId: created.id,
                        previous: { business: null },
                        changed: { business: true },
                        changedBy: 'operator:ben',
                        reason: 'Trade register extract handed in',
                    },
                    {
                        subscriberId: created.id,
                        previous: { vatId: null },
                        changed: { vatId: 'ATU12345678' },
                        changedBy: 'operator:anna',
                        reason: 'VAT id handed in after sign-up',
                    },
                    {
                        subscriberId: created.id,
                        previous: { country: 'DE' },
                        changed: { country: 'AT' },
                        changedBy: TENANT_USER,
                        reason: null,
                    },
                ],
                'the changes come back the latest written first, only the three that moved the tax origin, each with why where its write said why',
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
                    reason: 'Nobody to change',
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
                        {
                            business: true,
                            changedBy: 'operator:anna',
                            reason: 'Undone with its transaction',
                        },
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
            const createSubscriber = harness.seed.createSubscriber?.bind(harness.seed);
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
                correction: null,
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

        const CORRECTED_AT = new Date('2026-03-20T09:00:00.000Z');

        test('a correction names the charge it corrects, the invoice it stood on and the reason', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-correction');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;
            const [corrected] = await ledger.recordCharges([charge()]);

            const [written] = await ledger.recordCharges([
                counterEntryOf(corrected!, {
                    invoiceId: 'invoice-1',
                    by: 9.95,
                    reason: 'Half the month was not owed.',
                    bookedAt: CORRECTED_AT,
                }),
            ]);

            const read = (await ledger.listBySubscription(subscriptionId)).find(
                (entry) => entry.id === written?.id,
            );
            assert.deepEqual(
                [read?.origin, read?.amountNet, read?.correction, read?.contractLineItemId],
                [
                    'correction',
                    -9.95,
                    {
                        chargeId: corrected!.id,
                        invoiceId: 'invoice-1',
                        reason: 'Half the month was not owed.',
                    },
                    corrected!.contractLineItemId,
                ],
            );
            assert.deepEqual(
                [read?.source, read?.periodStart, read?.periodEnd],
                [corrected!.source, corrected!.periodStart, corrected!.periodEnd],
            );
            assert.equal(
                (await ledger.listBySubscription(subscriptionId)).find(
                    (entry) => entry.id === corrected!.id,
                )?.correction,
                null,
            );
        });

        test('a charge corrected on two invoices of its chain, and two charges of one period, are an entry each', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-corrections');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;
            const [renewal, change] = await ledger.recordCharges([
                charge(),
                charge({ origin: 'planChange', amountNet: 5 }),
            ]);
            const on = (corrected: SubscriberChargeRecord, invoiceId: string, by: number) =>
                counterEntryOf(corrected, {
                    invoiceId,
                    by,
                    reason: 'Not owed.',
                    bookedAt: CORRECTED_AT,
                });

            const written = await ledger.recordCharges([
                on(renewal!, 'invoice-1', 10),
                on(change!, 'invoice-1', 5),
                on(renewal!, 'invoice-3', 9.9),
            ]);

            assert.equal(
                written.length,
                3,
                'a correction collided with another under the natural key',
            );
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 5);
        });

        test('a correction naming a charge not in the journal is refused', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-correction-orphan');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;
            const [corrected] = await ledger.recordCharges([charge()]);
            const orphan = counterEntryOf(
                { ...corrected!, id: '00000000-0000-4000-8000-00000000c0de' },
                { invoiceId: 'invoice-1', by: 1, reason: 'Not owed.', bookedAt: CORRECTED_AT },
            );

            await assert.rejects(ledger.recordCharges([orphan]));
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 1);
        });

        test('a correction without what it corrects is refused, and so is another charge with it', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-correction-shape');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;
            const [corrected] = await ledger.recordCharges([charge()]);
            const parts = { chargeId: corrected!.id, invoiceId: 'invoice-1', reason: 'Not owed.' };

            await assert.rejects(
                ledger.recordCharges([charge({ origin: 'correction', sourceRef: 'invoice-1/x' })]),
            );
            await assert.rejects(
                ledger.recordCharges([charge({ origin: 'renewal', correction: parts })]),
            );
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 1);
        });

        test('a correction that takes nothing off, adds, or gives no reason is refused, with the call it came in', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-correction-amount');
            if (!account) return;
            const { ledger, subscriptionId, charge } = account;
            const [corrected] = await ledger.recordCharges([charge()]);
            const counterEntry = counterEntryOf(corrected!, {
                invoiceId: 'invoice-1',
                by: 9.95,
                reason: 'Not owed.',
                bookedAt: CORRECTED_AT,
            });

            for (const [what, written] of [
                ['takes nothing off', { ...counterEntry, amountNet: 0 }],
                ['adds', { ...counterEntry, amountNet: 9.95 }],
                [
                    'gives a reason of blanks',
                    {
                        ...counterEntry,
                        correction: {
                            chargeId: corrected!.id,
                            invoiceId: 'invoice-1',
                            reason: '   ',
                        },
                    },
                ],
            ] as const) {
                await assert.rejects(
                    ledger.recordCharges([charge({ origin: 'planChange', amountNet: 5 }), written]),
                    `a correction that ${what} was written`,
                );
            }
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 1);
        });

        test('a correction stands where the charge it corrects stands, and corrects no correction', async (t) => {
            const account = await anAccount(t, 'tenant-ledger-correction-place');
            const other = await anAccount(t, 'tenant-ledger-correction-elsewhere');
            if (!account || !other) return;
            const { ledger, subscriptionId, charge } = account;
            const [corrected] = await ledger.recordCharges([charge()]);
            const counterEntry = counterEntryOf(corrected!, {
                invoiceId: 'invoice-1',
                by: 9.95,
                reason: 'Not owed.',
                bookedAt: CORRECTED_AT,
            });
            const [correction] = await ledger.recordCharges([counterEntry]);
            const elsewhere = other.charge();
            const onInvoice = (invoiceId: string, chargeId: string) => ({
                sourceRef: `${invoiceId}/${chargeId}`,
                correction: { chargeId, invoiceId, reason: 'Not owed.' },
            });

            for (const [what, refused] of [
                [
                    "in another tenant's account",
                    {
                        ...counterEntry,
                        subscriberId: elsewhere.subscriberId,
                        tenantId: elsewhere.tenantId,
                        subscriptionId: elsewhere.subscriptionId,
                        contractId: elsewhere.contractId,
                        contractLineItemId: elsewhere.contractLineItemId,
                    },
                ],
                [
                    'taking off more than the charge asks',
                    {
                        ...counterEntry,
                        ...onInvoice('invoice-2', corrected!.id),
                        amountNet: -19.91,
                    },
                ],
                [
                    'of a correction',
                    { ...counterEntry, ...onInvoice('invoice-3', correction!.id), amountNet: -1 },
                ],
            ] as const) {
                await assert.rejects(
                    ledger.recordCharges([refused]),
                    `a correction ${what} was written`,
                );
            }
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 2);
            assert.deepEqual(await ledger.listBySubscription(elsewhere.subscriptionId), []);
        });

        test("a discount's correction gives back part of it, and one taking more off is refused", async (t) => {
            const account = await anAccount(t, 'tenant-ledger-correction-discount');
            if (!account) return;
            const { ledger, subscriptionId, discountLineId, charge } = account;
            const [discount] = await ledger.recordCharges([
                charge({
                    source: 'discount',
                    sourceRef: 'WELCOME20',
                    contractLineItemId: discountLineId,
                    amountNet: -3.98,
                }),
            ]);
            const givenBack = counterEntryOf(discount!, {
                invoiceId: 'invoice-1',
                by: 1.99,
                reason: 'Half the month was not owed.',
                bookedAt: CORRECTED_AT,
            });

            await assert.rejects(
                ledger.recordCharges([{ ...givenBack, amountNet: -1.99 }]),
                'a correction took more off a discount',
            );
            const [written] = await ledger.recordCharges([givenBack]);

            assert.deepEqual(
                [written?.amountNet, written?.correction?.chargeId],
                [1.99, discount!.id],
            );
            assert.equal((await ledger.listBySubscription(subscriptionId)).length, 2);
        });

        // -------------------------------------------------------------
        // Invoices — numbered without a gap, each charge on one invoice
        // -------------------------------------------------------------

        /**
         * A subscriber's account (`anAccount`) with what an invoice needs: a
         * writer for its charges and a builder for an invoice of 2026 under
         * `EX` over the charges it is handed. Null where the adapter provides
         * no invoices.
         */
        async function anInvoiceAccount(t: TestContext, tenantId: string) {
            const invoices = harness.adapter.subscriptionInvoiceRepository;
            if (!invoices || !CONTRACT_GAPS.subscriptionInvoices.present(harness)) {
                missing(t, 'subscriptionInvoices');
                return null;
            }
            const account = await anAccount(t, tenantId);
            if (!account) return null;
            const { ledger, charge } = account;
            const { subscriberId, contractId } = charge();
            const parties = partiesWith(subscriberId, `${tenantId} GmbH`);
            const record = async (
                ...overrides: Partial<NewSubscriberCharge>[]
            ): Promise<SubscriberChargeRecord[]> => {
                const written = await ledger.recordCharges(overrides.map((each) => charge(each)));
                assert.equal(written.length, overrides.length, 'a charge was not recorded');
                return written;
            };
            const invoiceOf = (
                charges: readonly SubscriberChargeRecord[],
                overrides: Partial<NewSubscriptionInvoice> = {},
                treatment: TaxTreatment = INVOICE_TREATMENT,
            ): NewSubscriptionInvoice => {
                const tax = taxPerRate(
                    charges.map((each) => ({ net: each.amountNet, rate: treatment.rate })),
                );
                return {
                    numberPrefix: 'EX',
                    numberYear: 2026,
                    tenantId,
                    subscriberId,
                    subscriptionId: charges[0]?.subscriptionId ?? account.subscriptionId,
                    contractId,
                    issuedAt: new Date('2026-02-01T05:15:00.000Z'),
                    issueDate: '2026-02-01',
                    dueDate: '2026-02-15',
                    servicePeriodFrom: '2026-02-01',
                    servicePeriodUntil: '2026-02-28',
                    payment: null,
                    collectionDate: null,
                    currency: 'EUR',
                    issuer: parties.issuer!,
                    subscriber: parties.subscriber,
                    footer: [],
                    taxTreatment: treatment,
                    taxes: tax.rates,
                    totalNet: tax.net,
                    totalTax: tax.tax,
                    totalGross: tax.gross,
                    lines: charges.map((each, index) => ({
                        position: index + 1,
                        chargeId: each.id,
                        contractLineItemId: each.contractLineItemId,
                        title: each.source === 'discount' ? 'Welcome discount' : 'Standard',
                        origin: each.origin,
                        source: each.source,
                        periodFrom: '2026-02-01',
                        periodUntil: '2026-02-28',
                        amountNet: each.amountNet,
                        taxRate: treatment.rate,
                    })),
                    ...overrides,
                };
            };
            return { ...account, invoices, subscriberId, record, invoiceOf };
        }

        /** The charge of the month starting `month` (0 for January), booked when it starts. */
        const monthly = (month: number): Partial<NewSubscriberCharge> => ({
            periodStart: new Date(Date.UTC(2026, month, 1)),
            periodEnd: new Date(Date.UTC(2026, month + 1, 1)),
            bookedAt: new Date(Date.UTC(2026, month, 1)),
        });

        // @requirement SC-PRIC-072
        test('invoices are numbered from 1 under their prefix and year, one after the other', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-numbers');
            if (!account) return;
            const { invoices, record, invoiceOf } = account;
            const [february, march] = await record(monthly(1), monthly(2));

            const first = await invoices.issue(invoiceOf([february!]));
            const second = await invoices.issue(invoiceOf([march!]));

            assert.deepEqual(
                [first, second].map((invoice) => [invoice.number, invoice.numberSequence]),
                [
                    ['EX-2026-000001', 1],
                    ['EX-2026-000002', 2],
                ],
            );
        });

        // @requirement SC-PRIC-072
        test('a new year starts its numbers at 1 again, and the year before runs on', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-years');
            if (!account) return;
            const { invoices, record, invoiceOf } = account;
            const [february, march, april] = await record(monthly(1), monthly(2), monthly(3));

            const numbers = [
                (await invoices.issue(invoiceOf([february!]))).number,
                (await invoices.issue(invoiceOf([march!], { numberYear: 2027 }))).number,
                (await invoices.issue(invoiceOf([april!]))).number,
            ];

            assert.deepEqual(numbers, ['EX-2026-000001', 'EX-2027-000001', 'EX-2026-000002']);
        });

        // @requirement SC-PRIC-072
        test('an invoice written on a transaction that rolls back hands its number back', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-rollback');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriberId } = account;
            const [february] = await record(monthly(1));

            await assert.rejects(
                harness.adapter.transactionRunner.run(async (tx) => {
                    await invoices.issue(invoiceOf([february!]), tx);
                    throw new Error('the run that issued it failed');
                }),
                /the run that issued it failed/,
            );

            assert.deepEqual(await invoices.listBySubscriber(subscriberId), []);
            assert.equal((await invoices.issue(invoiceOf([february!]))).number, 'EX-2026-000001');
        });

        // @requirement SC-PRIC-072
        test('an invoice refused on a transaction that goes on leaves nothing on it, and no number', async (t) => {
            // A caller may catch the refusal and commit what else it wrote;
            // the refused invoice must not be part of that.
            const account = await anInvoiceAccount(t, 'tenant-invoice-refused-in-tx');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriberId } = account;
            const [february, march] = await record(monthly(1), monthly(2));
            await invoices.issue(invoiceOf([february!]));

            const issuedAfter = await harness.adapter.transactionRunner.run(async (tx) => {
                await assert.rejects(
                    invoices.issue(invoiceOf([march!, february!]), tx),
                    refusedAs(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CHARGE_INVOICED),
                );
                return invoices.issue(invoiceOf([march!]), tx);
            });

            assert.equal(issuedAfter.number, 'EX-2026-000002');
            assert.deepEqual(
                (await invoices.listBySubscriber(subscriberId)).map((invoice) => [
                    invoice.number,
                    invoice.lines.map((line) => line.chargeId),
                ]),
                [
                    ['EX-2026-000002', [march!.id]],
                    ['EX-2026-000001', [february!.id]],
                ],
            );
        });

        // @requirement SC-PRIC-072
        test('invoices issued at the same time take consecutive numbers', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-race');
            if (!account) return;
            const { invoices, record, invoiceOf } = account;
            const charges = await record(monthly(1), monthly(2), monthly(3), monthly(4));

            const issued = await Promise.all(
                charges.map((each) => invoices.issue(invoiceOf([each]))),
            );

            assert.deepEqual(
                issued.map((invoice) => invoice.numberSequence).sort((a, b) => a - b),
                [1, 2, 3, 4],
            );
        });

        // @requirement SC-PRIC-096
        // @requirement SC-PRIC-072
        test('a charge stands on one invoice: a second one naming it is refused and draws no number', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-once');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriberId } = account;
            const [february, march] = await record(monthly(1), monthly(2));
            await invoices.issue(invoiceOf([february!]));

            await assert.rejects(
                invoices.issue(invoiceOf([march!, february!])),
                refusedAs(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CHARGE_INVOICED, {
                    chargeId: february!.id,
                }),
            );

            assert.equal((await invoices.listBySubscriber(subscriberId)).length, 1);
            assert.equal((await invoices.issue(invoiceOf([march!]))).number, 'EX-2026-000002');
        });

        // @requirement SC-PRIC-096
        test('two invoices naming the same charge at the same time: one is issued', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-once-race');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriberId } = account;
            const [february, march] = await record(monthly(1), monthly(2));

            const settled = await Promise.allSettled(
                Array.from({ length: 4 }, () => invoices.issue(invoiceOf([february!]))),
            );

            const refused = settled.filter((each) => each.status === 'rejected');
            assert.equal(refused.length, 3);
            for (const each of refused) {
                refusedAs(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CHARGE_INVOICED)(each.reason);
            }
            assert.equal((await invoices.listBySubscriber(subscriberId)).length, 1);
            assert.equal((await invoices.issue(invoiceOf([march!]))).number, 'EX-2026-000002');
        });

        // @requirement SC-PRIC-072
        test('an invoice naming a charge that does not exist is refused and draws no number', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-orphan');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriberId } = account;
            const [february] = await record(monthly(1));

            await assert.rejects(
                invoices.issue(
                    invoiceOf([{ ...february!, id: '00000000-0000-4000-8000-00000000c0de' }]),
                ),
            );

            assert.deepEqual(await invoices.listBySubscriber(subscriberId), []);
            assert.equal((await invoices.issue(invoiceOf([february!]))).number, 'EX-2026-000001');
        });

        // @requirement SC-PRIC-096
        test('the charges left to invoice are those on no invoice', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-left');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriptionId } = account;
            const [february, march] = await record(monthly(1), monthly(2));

            await invoices.issue(invoiceOf([february!]));

            assert.deepEqual(
                (await invoices.listUninvoicedCharges(subscriptionId)).map((each) => each.id),
                [march!.id],
            );
            assert.deepEqual(await invoices.listSubscriptionsWithUninvoicedCharges({ limit: 10 }), [
                subscriptionId,
            ]);

            await invoices.issue(invoiceOf([march!]));

            assert.deepEqual(await invoices.listUninvoicedCharges(subscriptionId), []);
            assert.deepEqual(
                await invoices.listSubscriptionsWithUninvoicedCharges({ limit: 10 }),
                [],
            );
        });

        // @requirement SC-PRIC-096
        test('a correction is never left to invoice: only the cancellation that wrote it does', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-correction');
            if (!account) return;
            const { invoices, ledger, record, invoiceOf, subscriptionId } = account;
            const [february, march] = await record(monthly(1), monthly(2));
            await invoices.issue(invoiceOf([february!]));
            const [correction] = await ledger.recordCharges([
                counterEntryOf(february!, {
                    invoiceId: 'invoice-1',
                    by: 19.9,
                    reason: 'Not owed.',
                    bookedAt: new Date('2026-03-20T09:00:00.000Z'),
                }),
            ]);
            assert.ok(correction, 'the correction was not recorded');

            assert.deepEqual(
                (await invoices.listUninvoicedCharges(subscriptionId)).map((each) => each.id),
                [march!.id],
            );

            await invoices.issue(invoiceOf([march!]));

            assert.deepEqual(await invoices.listUninvoicedCharges(subscriptionId), []);
            assert.deepEqual(
                await invoices.listSubscriptionsWithUninvoicedCharges({ limit: 10 }),
                [],
                'a subscription whose only charge left is a correction was due',
            );
        });

        // @requirement SC-PRIC-048
        test('a subscription whose charges left to invoice are all zero is not due', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-zero');
            if (!account) return;
            const { invoices, record, discountLineId } = account;
            const free = 'sub-tenant-invoice-zero-free';
            const zeroBeside = 'sub-tenant-invoice-zero-beside';
            const discounted = 'sub-tenant-invoice-zero-discounted';
            const discount = {
                source: 'discount' as const,
                sourceRef: 'WELCOME100',
                contractLineItemId: discountLineId,
            };
            await record(
                { subscriptionId: free, sourceRef: free, amountNet: 0 },
                { subscriptionId: free, sourceRef: free, amountNet: 0, ...monthly(2) },
                { subscriptionId: zeroBeside, sourceRef: zeroBeside, amountNet: 0 },
                { subscriptionId: zeroBeside, ...discount, amountNet: -3.98 },
                { subscriptionId: discounted, sourceRef: discounted, amountNet: 19.9 },
                { subscriptionId: discounted, ...discount, amountNet: -19.9 },
            );

            assert.deepEqual(
                [...(await invoices.listSubscriptionsWithUninvoicedCharges({ limit: 10 }))].sort(),
                [discounted, zeroBeside].sort(),
            );
            assert.equal(
                (await invoices.listUninvoicedCharges(free)).length,
                2,
                'a zero charge stays in the journal for the invoice that may come with it',
            );
        });

        // @requirement SC-PRIC-048
        test('a zero group beside another of the same subscription does not make it due on its own', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-zero-group');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriptionId } = account;
            const [february] = await record(
                { ...monthly(1), amountNet: 19.9 },
                { ...monthly(2), amountNet: 0 },
            );

            assert.deepEqual(await invoices.listSubscriptionsWithUninvoicedCharges({ limit: 10 }), [
                subscriptionId,
            ]);
            await invoices.issue(invoiceOf([february!]));

            assert.deepEqual(
                await invoices.listSubscriptionsWithUninvoicedCharges({ limit: 10 }),
                [],
            );
        });

        // @requirement SC-PRIC-048
        test('due subscriptions are read page by page, and one with only zero charges takes no place', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-due-pages');
            if (!account) return;
            const { invoices, record } = account;
            const subscription = (
                name: string,
                month: number,
                amountNet = 19.9,
            ): Partial<NewSubscriberCharge> => ({
                subscriptionId: name,
                sourceRef: name,
                amountNet,
                ...monthly(month),
            });
            await record(
                subscription('sub-page-c', 3),
                subscription('sub-page-a', 1),
                subscription('sub-page-b', 2),
                subscription('sub-page-b', 4),
                subscription('sub-page-bb', 2, 0),
            );
            const page = (after?: string) =>
                invoices.listSubscriptionsWithUninvoicedCharges({ limit: 2, after });

            assert.deepEqual(await page(), ['sub-page-a', 'sub-page-b']);
            assert.deepEqual(await page('sub-page-b'), ['sub-page-c']);
            assert.deepEqual(await page('sub-page-c'), []);
        });

        // @requirement SC-AUD-013
        // @requirement SC-PRIC-092
        // @requirement SC-PRIC-093
        test('an invoice reads back as it was written: its days, its cents, its parties, its footer and its treatment', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-exact');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriberId, discountLineId } = account;
            const [plan, discount] = await record(
                { ...monthly(11), amountNet: 99_999_999.99 },
                {
                    ...monthly(11),
                    source: 'discount',
                    sourceRef: 'WELCOME20',
                    contractLineItemId: discountLineId,
                    amountNet: -3.98,
                },
            );
            const written = invoiceOf(
                [plan!, discount!],
                {
                    issuedAt: new Date('2026-12-31T23:30:00.123Z'),
                    issueDate: '2027-01-01',
                    dueDate: '2027-01-15',
                    servicePeriodFrom: '2026-12-01',
                    servicePeriodUntil: '2026-12-31',
                    numberYear: 2027,
                    footer: [
                        'Amtsgericht München HRB 123456 · Geschäftsführer: Erika „Muster“',
                        'IBAN DE02 1203 0000 0000 2020 51 · BIC BYLADEM1001',
                    ],
                    subscriber: {
                        customerNumber: 'K-10002',
                        legalName: 'Müller & Söhne GmbH',
                        vatId: null,
                        taxNumber: null,
                        addressLine1: 'Am Ufer 3',
                        addressLine2: 'Hinterhaus',
                        postalCode: '20095',
                        city: 'Hamburg',
                        country: 'DE',
                    },
                },
                {
                    kind: 'reverse-charge',
                    rate: 0,
                    note: 'Steuerschuldnerschaft des Leistungsempfängers',
                    adapter: { name: '@saasicat/tax-de', version: '1.0.0-rc.25' },
                },
            );

            const issued = await invoices.issue(written);
            const read = await invoices.findById(issued.id);

            assert.ok(read);
            assert.deepEqual(read, issued, 'the invoice issued is the invoice read');
            const { lines, ...head } = written;
            const { id, number, numberSequence, lines: readLines, createdAt, ...readHead } = read;
            // An invoice the run issues begins a chain of its own, was paid
            // nothing on issue, corrects none, and none of its lines stands for
            // another invoice's.
            assert.deepEqual(readHead, {
                ...head,
                chainId: id,
                chainStep: 0,
                paidOnIssue: 0,
                correction: null,
            });
            assert.deepEqual(
                readLines.map(({ id: _lineId, invoiceId: _invoiceId, ...line }) => line),
                lines.map((line) => ({ ...line, correctedPosition: null, correctsPosition: null })),
            );
            assert.ok(readLines.every((line) => line.invoiceId === id));
            assert.deepEqual([number, numberSequence], ['EX-2027-000001', 1]);
            assert.ok(createdAt instanceof Date);
            assert.equal(await invoices.findById('00000000-0000-4000-8000-000000000000'), null);
            assert.deepEqual(
                (await invoices.listBySubscriber(subscriberId)).map((each) => each.id),
                [issued.id],
            );
        });

        // @requirement SC-PRIC-028
        // @requirement SC-PRIC-046
        test('an invoice reads back how it is paid: a direct debit with its mandate and the day it is collected, a card, or nothing', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-payment');
            if (!account) return;
            const { invoices, record, invoiceOf } = account;
            const [february, march, april] = await record(monthly(1), monthly(2), monthly(3));
            const debit: SubscriptionInvoicePayment = {
                paymentMethodId: 'payment-method-debit',
                gatewayAccount: 'stripe-main',
                type: 'sepa_debit',
                brand: null,
                last4: '3000',
                mandateReference: 'MANDAT-Ä-0001',
            };
            const card: SubscriptionInvoicePayment = {
                paymentMethodId: 'payment-method-card',
                gatewayAccount: 'stripe-main',
                type: 'card',
                brand: 'visa',
                last4: '4242',
                mandateReference: null,
            };

            const issued = [
                await invoices.issue(
                    invoiceOf([february!], {
                        payment: debit,
                        collectionDate: '2026-02-03',
                        dueDate: '2026-02-03',
                    }),
                ),
                await invoices.issue(invoiceOf([march!], { payment: card })),
                await invoices.issue(invoiceOf([april!])),
            ];

            assert.deepEqual(
                issued.map((invoice) => [invoice.payment, invoice.collectionDate, invoice.dueDate]),
                [
                    [debit, '2026-02-03', '2026-02-03'],
                    [card, null, '2026-02-15'],
                    [null, null, '2026-02-15'],
                ],
            );
            for (const invoice of issued) {
                assert.deepEqual(await invoices.findById(invoice.id), invoice);
            }
        });

        test("a subscriber's invoices come back latest number first, each with its lines in order", async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-list');
            if (!account) return;
            const { invoices, record, invoiceOf, subscriberId, discountLineId } = account;
            const [february, discount, march] = await record(
                monthly(1),
                {
                    ...monthly(1),
                    source: 'discount',
                    sourceRef: 'WELCOME20',
                    contractLineItemId: discountLineId,
                    amountNet: -3.98,
                },
                monthly(2),
            );
            await invoices.issue(invoiceOf([discount!, february!]));
            await invoices.issue(invoiceOf([march!]));

            const listed = await invoices.listBySubscriber(subscriberId);

            assert.deepEqual(
                listed.map((invoice) => [
                    invoice.number,
                    invoice.lines.map((line) => line.chargeId),
                ]),
                [
                    ['EX-2026-000002', [march!.id]],
                    ['EX-2026-000001', [discount!.id, february!.id]],
                ],
            );
            assert.deepEqual(await invoices.listBySubscriber('no-such-subscriber'), []);
        });

        // @requirement SC-PRIC-024
        test('the prefixes invoices were issued under are listed, two at most', async (t) => {
            const account = await anInvoiceAccount(t, 'tenant-invoice-prefixes');
            if (!account) return;
            const { invoices, record, invoiceOf } = account;
            const [february, march, april] = await record(monthly(1), monthly(2), monthly(3));

            assert.deepEqual(await invoices.listIssuedNumberPrefixes(), []);
            await invoices.issue(invoiceOf([february!]));
            assert.deepEqual(await invoices.listIssuedNumberPrefixes(), ['EX']);
            await invoices.issue(invoiceOf([march!], { numberPrefix: 'AB' }));
            await invoices.issue(invoiceOf([april!], { numberPrefix: 'ZZ' }));

            const prefixes = await invoices.listIssuedNumberPrefixes();
            assert.equal(prefixes.length, 2);
            assert.ok(prefixes.every((prefix) => ['AB', 'EX', 'ZZ'].includes(prefix)));
        });

        // -------------------------------------------------------------
        // An invoice's document — its checksum recorded once, archived once
        // -------------------------------------------------------------

        /** A rendering as the invoice run records it, before its file is archived. */
        const renderingOf = (checksum: string) => ({
            checksum,
            mediaType: 'application/pdf',
            fileName: 'EX-2026-000001.pdf',
            size: 2048,
            renderedAt: new Date('2026-02-01T05:16:00.000Z'),
        });
        const CHECKSUM = 'a'.repeat(64);
        const OTHER_CHECKSUM = 'b'.repeat(64);

        /** Issued invoices of one account, `count` of them, one charge each. Null without invoices. */
        async function issuedInvoices(t: TestContext, tenantId: string, count = 1) {
            const account = await anInvoiceAccount(t, tenantId);
            if (!account) return null;
            const charges = await account.record(
                ...Array.from({ length: count }, (_, index) => monthly(index + 1)),
            );
            const issued = [];
            for (const charge of charges) {
                issued.push(await account.invoices.issue(account.invoiceOf([charge])));
            }
            return { ...account, issued };
        }

        // @requirement SC-AUD-019
        test("an invoice's rendering is recorded once, and another checksum for it is refused", async (t) => {
            const account = await issuedInvoices(t, 'tenant-document-once');
            if (!account) return;
            const { invoices, issued } = account;
            const [invoice] = issued;

            const first = await invoices.recordRendering(invoice!.id, renderingOf(CHECKSUM));
            const again = await invoices.recordRendering(invoice!.id, {
                ...renderingOf(CHECKSUM),
                renderedAt: new Date('2026-02-01T05:31:00.000Z'),
            });

            assert.deepEqual(again, first, 'a second recording of the same file changed the first');
            await assert.rejects(
                invoices.recordRendering(invoice!.id, renderingOf(OTHER_CHECKSUM)),
                refusedAs(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED, {
                    invoiceId: invoice!.id,
                    recorded: CHECKSUM,
                    rendered: OTHER_CHECKSUM,
                }),
            );
            assert.deepEqual(await invoices.findDocument(invoice!.id), first);
            assert.deepEqual(first, {
                invoiceId: invoice!.id,
                ...renderingOf(CHECKSUM),
                archivedAt: null,
                deliveryClaimedAt: null,
                deliveredAt: null,
                deliveredTo: null,
            });
        });

        test("an invoice's rendering written on a transaction that rolls back is undone with it", async (t) => {
            const account = await issuedInvoices(t, 'tenant-document-rollback');
            if (!account) return;
            const { invoices, issued } = account;
            const [invoice] = issued;

            await assert.rejects(
                harness.adapter.transactionRunner.run(async (tx) => {
                    await invoices.recordRendering(invoice!.id, renderingOf(CHECKSUM), tx);
                    throw new Error('the run that rendered it failed');
                }),
                /the run that rendered it failed/,
            );

            assert.equal(await invoices.findDocument(invoice!.id), null);
            assert.equal(
                (await invoices.recordRendering(invoice!.id, renderingOf(OTHER_CHECKSUM))).checksum,
                OTHER_CHECKSUM,
            );
        });

        // @requirement SC-AUD-019 — An archived invoice is checked against the checksum of the file it was issued as
        test("an invoice's rendering is replaced only in place of the one recorded, and only while nothing is archived", async (t) => {
            const account = await issuedInvoices(t, 'tenant-document-replace');
            if (!account) return;
            const { invoices, issued } = account;
            const [invoice] = issued;
            const renderedAgain = new Date('2026-02-01T05:31:00.000Z');
            await invoices.recordRendering(invoice!.id, renderingOf(CHECKSUM));

            assert.equal(
                await invoices.replaceRendering(
                    invoice!.id,
                    renderingOf(OTHER_CHECKSUM),
                    OTHER_CHECKSUM,
                ),
                null,
                'a rendering was replaced in place of one not recorded',
            );
            const replaced = await invoices.replaceRendering(
                invoice!.id,
                { ...renderingOf(OTHER_CHECKSUM), size: 4096, renderedAt: renderedAgain },
                CHECKSUM,
            );
            assert.deepEqual(replaced, {
                invoiceId: invoice!.id,
                ...renderingOf(OTHER_CHECKSUM),
                size: 4096,
                renderedAt: renderedAgain,
                archivedAt: null,
                deliveryClaimedAt: null,
                deliveredAt: null,
                deliveredTo: null,
            });
            assert.deepEqual(await invoices.findDocument(invoice!.id), replaced);

            await invoices.markArchived(invoice!.id, renderedAgain, OTHER_CHECKSUM);
            assert.equal(
                await invoices.replaceRendering(invoice!.id, renderingOf(CHECKSUM), OTHER_CHECKSUM),
                null,
                'an archived rendering was replaced',
            );
            assert.equal((await invoices.findDocument(invoice!.id))!.checksum, OTHER_CHECKSUM);
        });

        // @requirement SC-AUD-019 — An archived invoice is checked against the checksum of the file it was issued as
        test("of two runs replacing an invoice's rendering at once, one does", async (t) => {
            const account = await issuedInvoices(t, 'tenant-document-replace-race');
            if (!account) return;
            const { invoices, issued } = account;
            const [invoice] = issued;
            await invoices.recordRendering(invoice!.id, renderingOf(CHECKSUM));

            const outcomes = await Promise.all(
                ['c', 'd', 'e'].map((digit) =>
                    invoices.replaceRendering(invoice!.id, renderingOf(digit.repeat(64)), CHECKSUM),
                ),
            );

            const won = outcomes.filter((record) => record !== null);
            assert.equal(won.length, 1, JSON.stringify(outcomes));
            assert.equal((await invoices.findDocument(invoice!.id))!.checksum, won[0]!.checksum);
        });

        test('a rendering for an invoice that does not exist is refused', async (t) => {
            const account = await issuedInvoices(t, 'tenant-document-orphan', 0);
            if (!account) return;

            await assert.rejects(
                account.invoices.recordRendering(NO_SUCH_VERSION, renderingOf(CHECKSUM)),
            );
            assert.equal(await account.invoices.findDocument(NO_SUCH_VERSION), null);
        });

        /** The moments of one mailing: a claim, the lease it is held under, and its record. */
        const CLAIMED_AT = new Date('2026-02-01T05:18:00.000Z');
        const LEASE_START = new Date('2026-02-01T05:03:00.000Z');
        const DELIVERY = {
            claimedAt: CLAIMED_AT,
            at: new Date('2026-02-01T05:18:30.000Z'),
            to: 'billing@example.com',
        };

        /** An issued invoice, rendered and archived. Null without invoices. */
        async function anArchivedInvoice(t: TestContext, tenantId: string) {
            const account = await issuedInvoices(t, tenantId);
            if (!account) return null;
            const [invoice] = account.issued;
            await account.invoices.recordRendering(invoice!.id, renderingOf(CHECKSUM));
            await account.invoices.markArchived(
                invoice!.id,
                new Date('2026-02-01T05:17:00.000Z'),
                CHECKSUM,
            );
            return { invoices: account.invoices, invoiceId: invoice!.id };
        }

        // @requirement SC-PRIC-033
        // @requirement SC-PRIC-094
        test('an invoice is archived once, and handed to the mail once, only after it is archived', async (t) => {
            const account = await issuedInvoices(t, 'tenant-document-marks');
            if (!account) return;
            const { invoices, issued } = account;
            const [invoice] = issued;
            const archivedAt = new Date('2026-02-01T05:17:00.000Z');
            await invoices.recordRendering(invoice!.id, renderingOf(CHECKSUM));

            assert.equal(
                await invoices.claimDelivery(invoice!.id, CLAIMED_AT, LEASE_START),
                false,
                'an invoice not archived was claimed for the mail',
            );
            assert.equal(await invoices.markDelivered(invoice!.id, DELIVERY), false);
            assert.equal(
                await invoices.markArchived(invoice!.id, archivedAt, OTHER_CHECKSUM),
                false,
                'a file other than the recorded one was confirmed',
            );
            assert.equal(await invoices.markArchived(invoice!.id, archivedAt, CHECKSUM), true);
            assert.equal(
                await invoices.markArchived(
                    invoice!.id,
                    new Date('2026-02-02T00:00:00.000Z'),
                    CHECKSUM,
                ),
                false,
            );
            assert.equal(await invoices.claimDelivery(invoice!.id, CLAIMED_AT, LEASE_START), true);
            assert.equal(await invoices.markDelivered(invoice!.id, DELIVERY), true);
            assert.equal(
                await invoices.markDelivered(invoice!.id, { ...DELIVERY, to: 'other@example.com' }),
                false,
            );
            assert.equal(
                await invoices.claimDelivery(
                    invoice!.id,
                    new Date('2026-02-02T00:00:00.000Z'),
                    archivedAt,
                ),
                false,
                'a delivered invoice was claimed again',
            );

            const document = await invoices.findDocument(invoice!.id);
            assert.deepEqual(
                [
                    document!.archivedAt,
                    document!.deliveryClaimedAt,
                    document!.deliveredAt,
                    document!.deliveredTo,
                ],
                [archivedAt, CLAIMED_AT, DELIVERY.at, DELIVERY.to],
            );
        });

        // @requirement SC-PRIC-094
        test("an invoice's mail held by a fresh claim is not taken, and one held by a stale claim is", async (t) => {
            const archived = await anArchivedInvoice(t, 'tenant-delivery-lease');
            if (!archived) return;
            const { invoices, invoiceId } = archived;
            const later = new Date('2026-02-01T05:33:00.000Z');
            await invoices.claimDelivery(invoiceId, CLAIMED_AT, LEASE_START);

            // A claim taken exactly when the lease starts still holds; one a
            // millisecond older is stale.
            assert.equal(await invoices.claimDelivery(invoiceId, later, CLAIMED_AT), false);
            assert.equal(
                await invoices.claimDelivery(invoiceId, later, new Date(CLAIMED_AT.getTime() + 1)),
                true,
            );

            // The run whose claim went stale can neither record the mail nor let it go.
            assert.equal(await invoices.markDelivered(invoiceId, DELIVERY), false);
            await invoices.releaseDelivery(invoiceId, CLAIMED_AT);
            assert.deepEqual((await invoices.findDocument(invoiceId))!.deliveryClaimedAt, later);
            assert.equal(
                await invoices.markDelivered(invoiceId, { ...DELIVERY, claimedAt: later }),
                true,
            );
        });

        // @requirement SC-PRIC-094
        test("an invoice's mail let go is taken by the next run at once, and a delivered one stays delivered", async (t) => {
            const archived = await anArchivedInvoice(t, 'tenant-delivery-release');
            if (!archived) return;
            const { invoices, invoiceId } = archived;
            const next = new Date('2026-02-01T05:33:00.000Z');
            await invoices.claimDelivery(invoiceId, CLAIMED_AT, LEASE_START);

            await invoices.releaseDelivery(invoiceId, CLAIMED_AT);
            assert.equal((await invoices.findDocument(invoiceId))!.deliveryClaimedAt, null);
            assert.equal(await invoices.claimDelivery(invoiceId, next, LEASE_START), true);

            await invoices.markDelivered(invoiceId, { ...DELIVERY, claimedAt: next });
            await invoices.releaseDelivery(invoiceId, next);
            const document = await invoices.findDocument(invoiceId);
            assert.deepEqual(
                [document!.deliveryClaimedAt, document!.deliveredAt],
                [next, DELIVERY.at],
            );
        });

        // @requirement SC-PRIC-094
        test("of concurrent claims on an invoice's mail exactly one holds it", async (t) => {
            const archived = await anArchivedInvoice(t, 'tenant-delivery-race');
            if (!archived) return;
            const { invoices, invoiceId } = archived;

            const claims = await Promise.all(
                Array.from({ length: 5 }, (_, index) =>
                    invoices.claimDelivery(
                        invoiceId,
                        new Date(CLAIMED_AT.getTime() + index),
                        LEASE_START,
                    ),
                ),
            );

            assert.equal(claims.filter(Boolean).length, 1, JSON.stringify(claims));
        });

        // @requirement SC-PRIC-033
        test('the invoices waiting for their document, and for the mail, are read page by page', async (t) => {
            const account = await issuedInvoices(t, 'tenant-document-waiting', 4);
            if (!account) return;
            const { invoices, issued } = account;
            const ids = issued.map((invoice) => invoice.id).sort();
            const [unrendered, rendered, archived, delivered] = ids as [
                string,
                string,
                string,
                string,
            ];
            const at = new Date('2026-02-01T05:17:00.000Z');
            for (const id of [rendered, archived, delivered]) {
                await invoices.recordRendering(id, renderingOf(CHECKSUM));
            }
            for (const id of [archived, delivered]) await invoices.markArchived(id, at, CHECKSUM);
            // Held by a run, and still waiting for the mail.
            await invoices.claimDelivery(archived, at, LEASE_START);
            await invoices.claimDelivery(delivered, at, LEASE_START);
            await invoices.markDelivered(delivered, {
                claimedAt: at,
                at,
                to: 'billing@example.com',
            });

            assert.deepEqual(await invoices.listAwaitingDocument({ limit: 10 }), [
                unrendered,
                rendered,
            ]);
            assert.deepEqual(await invoices.listAwaitingDocument({ limit: 1 }), [unrendered]);
            assert.deepEqual(
                await invoices.listAwaitingDocument({ limit: 10, after: unrendered }),
                [rendered],
            );
            assert.deepEqual(await invoices.listAwaitingDelivery({ limit: 10 }), [archived]);
            assert.deepEqual(
                await invoices.listAwaitingDelivery({ limit: 10, after: archived }),
                [],
            );
        });

        // -------------------------------------------------------------
        // Collections — one attempt not settled per invoice, and its outcome once
        // -------------------------------------------------------------

        /** The card an invoice collected by card records. */
        const CARD: SubscriptionInvoicePayment = {
            paymentMethodId: 'payment-method-card',
            gatewayAccount: 'stripe-main',
            type: 'card',
            brand: 'visa',
            last4: '4242',
            mandateReference: null,
        };

        /** The direct debit an invoice collected by one records. */
        const DEBIT: SubscriptionInvoicePayment = {
            paymentMethodId: 'payment-method-debit',
            gatewayAccount: 'stripe-main',
            type: 'sepa_debit',
            brand: null,
            last4: '3000',
            mandateReference: 'MANDAT-0001',
        };

        /** The moment a run starts an attempt, and the attempt it starts for `invoiceId`. */
        const STARTED_AT = new Date('2026-02-01T05:20:00.000Z');
        const attemptOf = (
            invoiceId: string,
            at = STARTED_AT,
            gatewayAccount = 'stripe-main',
        ): NewInvoiceCollection => ({
            invoiceId,
            gatewayAccount,
            paymentMethodId: 'payment-method-card',
            paymentMethodType: 'card',
            customerRef: 'cus_1',
            paymentMethodRef: 'pm_1',
            invoiceNumber: 'EX-2026-000001',
            currency: 'EUR',
            at,
        });

        /** The attempt a run plans for `invoiceId` after attempt `after`, collected from `collectOn`. */
        const planOf = (
            invoiceId: string,
            {
                after = 0,
                collectOn = '2026-02-22',
                paymentMethodType = 'card',
            }: {
                after?: number;
                collectOn?: string;
                paymentMethodType?: 'card' | 'sepa_debit';
            } = {},
        ): PlannedInvoiceCollection => ({
            invoiceId,
            after,
            gatewayAccount: 'stripe-main',
            paymentMethodId: `payment-method-${paymentMethodType}`,
            paymentMethodType,
            customerRef: 'cus_1',
            paymentMethodRef: 'pm_1',
            invoiceNumber: 'EX-2026-000001',
            currency: 'EUR',
            collectOn,
        });

        /** What a failed attempt records. */
        const FAILURE = {
            status: 'failed' as const,
            paymentRef: 'pi_1',
            reason: 'insufficient-funds' as const,
            gatewayCode: 'insufficient_funds',
        };

        /**
         * A subscriber's invoices to collect, each issued with `payment` and
         * `collectionDate` and handed to the mail unless `delivered` is false.
         * Null where the adapter provides no collections.
         */
        async function collectable(
            t: TestContext,
            tenantId: string,
            invoices: Array<{
                payment?: SubscriptionInvoicePayment | null;
                collectionDate?: string | null;
                delivered?: boolean;
            }> = [{}],
        ) {
            const collections = harness.adapter.invoiceCollectionRepository;
            if (!collections || !CONTRACT_GAPS.invoiceCollections.present(harness)) {
                missing(t, 'invoiceCollections');
                return null;
            }
            const account = await anInvoiceAccount(t, tenantId);
            if (!account) return null;
            const charges = await account.record(...invoices.map((_, index) => monthly(index + 1)));
            const ids: string[] = [];
            for (const [index, wanted] of invoices.entries()) {
                const collectionDate = wanted.collectionDate ?? null;
                const issued = await account.invoices.issue(
                    account.invoiceOf([charges[index]!], {
                        payment: wanted.payment === undefined ? CARD : wanted.payment,
                        collectionDate,
                        dueDate: collectionDate ?? '2026-02-15',
                    }),
                );
                await account.invoices.recordRendering(issued.id, renderingOf(CHECKSUM));
                await account.invoices.markArchived(issued.id, STARTED_AT, CHECKSUM);
                if (wanted.delivered !== false) {
                    await account.invoices.claimDelivery(issued.id, STARTED_AT, STARTED_AT);
                    await account.invoices.markDelivered(issued.id, {
                        claimedAt: STARTED_AT,
                        at: STARTED_AT,
                        to: 'billing@example.com',
                    });
                }
                ids.push(issued.id);
            }
            return { ...account, collections, ids };
        }

        // @requirement SC-PRIC-082
        // @requirement SC-PRIC-028
        test('an invoice is due once it was mailed: by card at once, by direct debit from the day it announced, until it has an attempt', async (t) => {
            const account = await collectable(t, 'tenant-collect-due', [
                {},
                { delivered: false },
                { payment: DEBIT, collectionDate: '2026-02-15' },
                { payment: null },
            ]);
            if (!account) return;
            const { collections, ids } = account;
            const [byCard, notMailed, byDebit] = ids;
            const due = (today: string) =>
                collections
                    .listDue(today, { limit: 10 })
                    .then((found) => found.filter((id) => ids.includes(id)).sort());

            assert.deepEqual(await due('2026-02-14'), [byCard!].sort());
            assert.deepEqual(await due('2026-02-15'), [byCard!, byDebit!].sort());
            assert.ok(
                !(await due('2026-12-31')).includes(notMailed!),
                'an invoice not mailed is due',
            );

            await collections.startAttempt(attemptOf(byCard!));

            assert.deepEqual(await due('2026-02-15'), [byDebit!]);
        });

        test('the invoices due are read page by page', async (t) => {
            const account = await collectable(t, 'tenant-collect-pages', [{}, {}, {}]);
            if (!account) return;
            const { collections, ids } = account;
            const sorted = [...ids].sort();

            const first = await collections.listDue('2026-02-15', { limit: 2 });
            const rest = await collections.listDue('2026-02-15', { limit: 2, after: first.at(-1) });

            assert.deepEqual(
                [...first, ...rest].filter((id) => ids.includes(id)),
                sorted,
            );
            assert.equal(first.length, 2);
        });

        // @requirement SC-PRIC-034
        test('an attempt is numbered from 1 under its key and written as submitted with what its request carries', async (t) => {
            const account = await collectable(t, 'tenant-collect-start');
            if (!account) return;
            const { collections, ids, invoices } = account;
            const [invoiceId] = ids;
            const gross = (await invoices.findById(invoiceId!))!.totalGross;

            const started = await collections.startAttempt(attemptOf(invoiceId!));

            assert.ok(started);
            const { id, ...rest } = started;
            assert.deepEqual(rest, {
                invoiceId,
                attempt: 1,
                attemptKey: collectionAttemptKey(invoiceId!, 1),
                gatewayAccount: 'stripe-main',
                paymentMethodId: 'payment-method-card',
                paymentMethodType: 'card',
                customerRef: 'cus_1',
                paymentMethodRef: 'pm_1',
                invoiceNumber: 'EX-2026-000001',
                // What the invoice owes, which the store reads in its turn.
                amount: gross,
                currency: 'EUR',
                status: 'SUBMITTED',
                paymentRef: null,
                failureReason: null,
                failureCode: null,
                submittedAt: STARTED_AT,
                heldAt: STARTED_AT,
                resolvedAt: null,
                collectOn: null,
                announcedAt: null,
                followedUpAt: null,
            });
            assert.deepEqual(await collections.findById(id), started);
            assert.deepEqual(await collections.listByInvoice(invoiceId!), [started]);
            assert.equal(await collections.findById(NO_SUCH_VERSION), null);
        });

        // @requirement SC-PRIC-034
        // @requirement SC-PRIC-080
        test('the first attempt is started once, and never beside another; after a failure the next is planned, numbered 2', async (t) => {
            const account = await collectable(t, 'tenant-collect-one-open');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;
            const first = await collections.startAttempt(attemptOf(invoiceId!));

            assert.equal(await collections.startAttempt(attemptOf(invoiceId!)), null);
            await collections.recordOutcome(
                first!.id,
                { status: 'pending', paymentRef: 'pi_1' },
                STARTED_AT,
            );
            assert.equal(await collections.startAttempt(attemptOf(invoiceId!)), null);
            await collections.recordOutcome(
                first!.id,
                {
                    status: 'failed',
                    paymentRef: 'pi_1',
                    reason: 'insufficient-funds',
                    gatewayCode: 'insufficient_funds',
                },
                STARTED_AT,
            );

            assert.equal(
                await collections.startAttempt(attemptOf(invoiceId!)),
                null,
                'a first attempt was started after one failed',
            );
            const planned = await collections.plan(planOf(invoiceId!, { after: 1 }));
            assert.deepEqual(
                [planned?.attempt, planned?.attemptKey],
                [2, collectionAttemptKey(invoiceId!, 2)],
            );
            const second = await collections.submitPlanned(planned!.id, STARTED_AT);
            await collections.recordOutcome(
                second!.id,
                { status: 'succeeded', paymentRef: 'pi_2', amountCents: 2368, currency: 'EUR' },
                STARTED_AT,
            );
            assert.equal(await collections.plan(planOf(invoiceId!, { after: 2 })), null);
            assert.deepEqual(
                (await collections.listByInvoice(invoiceId!)).map((each) => [
                    each.attempt,
                    each.status,
                ]),
                [
                    [1, 'FAILED'],
                    [2, 'SUCCEEDED'],
                ],
            );
        });

        // @requirement SC-PRIC-034
        // @requirement SC-PRIC-036
        test('attempts started at the same time for one invoice: one is, and the others are told', async (t) => {
            const account = await collectable(t, 'tenant-collect-race');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;

            const started = await Promise.all(
                Array.from({ length: 5 }, () => collections.startAttempt(attemptOf(invoiceId!))),
            );

            assert.equal(started.filter((each) => each !== null).length, 1);
            assert.equal((await collections.listByInvoice(invoiceId!)).length, 1);
        });

        // @requirement SC-PRIC-036
        test('an attempt is started in the invoice’s turn: a second waits for the first transaction, then is told', async (t) => {
            const { adapter } = harness;
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no pessimistic-locking capability');
                return;
            }
            const account = await collectable(t, 'tenant-collect-turn');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;

            const sections: Array<{ enter: number; exit: number; started: boolean }> = [];
            const critical = (tx: TransactionContext) =>
                collections.startAttempt(attemptOf(invoiceId!), tx).then(async (started) => {
                    const enter = Date.now();
                    await sleep(LOCK_HOLD_MS);
                    sections.push({ enter, exit: Date.now(), started: started !== null });
                });

            await Promise.all([
                adapter.transactionRunner.run(critical),
                adapter.transactionRunner.run(critical),
            ]);

            sections.sort((a, b) => a.enter - b.enter);
            assert.deepEqual(
                sections.map((each) => each.started),
                [true, false],
            );
            assert.ok(
                sections[1]!.enter >= sections[0]!.exit,
                'the second attempt was decided before the first transaction ended',
            );
        });

        test('an attempt started on a transaction that rolls back is gone, and the invoice is due again', async (t) => {
            const account = await collectable(t, 'tenant-collect-rollback');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;

            await assert.rejects(
                harness.adapter.transactionRunner.run(async (tx) => {
                    await collections.startAttempt(attemptOf(invoiceId!), tx);
                    throw new Error('the request was never sent');
                }),
                /never sent/,
            );

            assert.deepEqual(await collections.listByInvoice(invoiceId!), []);
            assert.ok(
                (await collections.listDue('2026-02-15', { limit: 50 })).includes(invoiceId!),
            );
        });

        test('an attempt for an invoice that does not exist is refused', async (t) => {
            const account = await collectable(t, 'tenant-collect-orphan', []);
            if (!account) return;

            await assert.rejects(account.collections.startAttempt(attemptOf(NO_SUCH_VERSION)));
        });

        // @requirement SC-PRIC-034
        test('an outcome is recorded once: a direct debit on its way stays open, and an answer to a settled attempt changes nothing', async (t) => {
            const account = await collectable(t, 'tenant-collect-outcome');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;
            const attempt = await collections.startAttempt(attemptOf(invoiceId!));
            const settledAt = new Date('2026-02-07T05:00:00.000Z');

            assert.equal(
                await collections.recordOutcome(
                    attempt!.id,
                    { status: 'pending', paymentRef: 'pi_1' },
                    STARTED_AT,
                ),
                true,
            );
            const pending = await collections.findById(attempt!.id);
            assert.deepEqual(
                [pending!.status, pending!.paymentRef, pending!.resolvedAt],
                ['PENDING', 'pi_1', null],
            );

            const failure = {
                status: 'failed' as const,
                paymentRef: 'pi_1',
                reason: 'mandate-invalid' as const,
                gatewayCode: 'debit_not_authorized',
            };
            assert.equal(await collections.recordOutcome(attempt!.id, failure, settledAt), true);
            assert.equal(
                await collections.recordOutcome(
                    attempt!.id,
                    { status: 'pending', paymentRef: 'pi_1' },
                    new Date('2026-02-08T05:00:00.000Z'),
                ),
                false,
                'an answer changed a settled attempt',
            );
            const settled = await collections.findById(attempt!.id);
            assert.deepEqual(
                [
                    settled!.status,
                    settled!.failureReason,
                    settled!.failureCode,
                    settled!.resolvedAt,
                ],
                ['FAILED', 'mandate-invalid', 'debit_not_authorized', settledAt],
            );
        });

        // @requirement SC-PRIC-030
        test('the accounts attempts not settled were sent to are listed, each once, and a settled one is not', async (t) => {
            const account = await collectable(t, 'tenant-collect-accounts', [{}, {}, {}, {}]);
            if (!account) return;
            const { collections, ids } = account;
            const [first, second, third, fourth] = ids;
            const pending = await collections.startAttempt(attemptOf(first!));
            await collections.startAttempt(attemptOf(second!));
            const settled = await collections.startAttempt(
                attemptOf(third!, STARTED_AT, 'stripe-old'),
            );
            await collections.recordOutcome(
                pending!.id,
                { status: 'pending', paymentRef: 'pi_1' },
                STARTED_AT,
            );
            await collections.recordOutcome(
                settled!.id,
                { status: 'succeeded', paymentRef: 'pi_3', amountCents: 2368, currency: 'EUR' },
                STARTED_AT,
            );

            assert.deepEqual(await collections.accountsInUse(), ['stripe-main']);

            await collections.startAttempt(attemptOf(fourth!, STARTED_AT, 'stripe-old'));

            assert.deepEqual(await collections.accountsInUse(), ['stripe-main', 'stripe-old']);
        });

        // @requirement SC-PRIC-034
        test('an attempt not settled is taken on again once its hold is old enough, by one run, and listed until then', async (t) => {
            const account = await collectable(t, 'tenant-collect-hold', [{}, {}, {}]);
            if (!account) return;
            const { collections, ids } = account;
            const [submitted, pending, settled] = await Promise.all(
                ids.map((invoiceId) => collections.startAttempt(attemptOf(invoiceId))),
            );
            await collections.recordOutcome(
                pending!.id,
                { status: 'pending', paymentRef: 'pi_2' },
                STARTED_AT,
            );
            await collections.recordOutcome(
                settled!.id,
                { status: 'succeeded', paymentRef: 'pi_3', amountCents: 2368, currency: 'EUR' },
                STARTED_AT,
            );
            const later = new Date(STARTED_AT.getTime() + 1);
            const mine = (found: string[]) =>
                found.filter((id) => [submitted, pending, settled].some((a) => a!.id === id));

            assert.deepEqual(
                mine(
                    await collections.listUnsettled(
                        { submittedBefore: STARTED_AT, pendingBefore: STARTED_AT },
                        { limit: 50 },
                    ),
                ),
                [],
                'an attempt held exactly as long as the lease was listed',
            );
            assert.deepEqual(
                mine(
                    await collections.listUnsettled(
                        { submittedBefore: later, pendingBefore: STARTED_AT },
                        { limit: 50 },
                    ),
                ),
                [submitted!.id],
            );
            assert.deepEqual(
                mine(
                    await collections.listUnsettled(
                        { submittedBefore: later, pendingBefore: later },
                        { limit: 50 },
                    ),
                ).sort(),
                [submitted!.id, pending!.id].sort(),
            );

            const takenAt = new Date('2026-02-01T06:00:00.000Z');
            assert.equal(await collections.hold(submitted!.id, STARTED_AT, takenAt), false);
            const holds = await Promise.all(
                Array.from({ length: 3 }, () => collections.hold(submitted!.id, later, takenAt)),
            );
            assert.equal(holds.filter(Boolean).length, 1);
            assert.equal(await collections.hold(settled!.id, takenAt, takenAt), false);
            assert.deepEqual((await collections.findById(submitted!.id))!.heldAt, takenAt);
            assert.deepEqual(
                mine(
                    await collections.listUnsettled(
                        { submittedBefore: later, pendingBefore: later },
                        { limit: 50 },
                    ),
                ),
                [pending!.id],
            );
        });

        // @requirement SC-PRIC-080
        // @requirement SC-PRIC-082
        test('an attempt is planned for its day with nothing sent, keeps the invoice from another, and is taken up as sent by one run', async (t) => {
            const account = await collectable(t, 'tenant-collect-plan');
            if (!account) return;
            const { collections, ids, invoices } = account;
            const [invoiceId] = ids;
            const gross = (await invoices.findById(invoiceId!))!.totalGross;

            const planned = await collections.plan(planOf(invoiceId!));

            assert.ok(planned);
            const { id, ...rest } = planned;
            assert.deepEqual(rest, {
                invoiceId,
                attempt: 1,
                attemptKey: collectionAttemptKey(invoiceId!, 1),
                gatewayAccount: 'stripe-main',
                paymentMethodId: 'payment-method-card',
                paymentMethodType: 'card',
                customerRef: 'cus_1',
                paymentMethodRef: 'pm_1',
                invoiceNumber: 'EX-2026-000001',
                amount: gross,
                currency: 'EUR',
                status: 'SCHEDULED',
                paymentRef: null,
                failureReason: null,
                failureCode: null,
                submittedAt: null,
                heldAt: null,
                resolvedAt: null,
                collectOn: '2026-02-22',
                announcedAt: null,
                followedUpAt: null,
            });
            assert.deepEqual(await collections.findById(id), planned);
            assert.ok((await collections.listPlanned({ limit: 50 })).includes(id));
            assert.ok(
                !(await collections.listDue('2026-12-31', { limit: 50 })).includes(invoiceId!),
            );
            assert.equal(await collections.plan(planOf(invoiceId!)), null);
            assert.equal(await collections.startAttempt(attemptOf(invoiceId!)), null);

            const takenAt = new Date('2026-02-22T05:20:00.000Z');
            const taken = await Promise.all(
                Array.from({ length: 3 }, () => collections.submitPlanned(id, takenAt)),
            );

            const sent = taken.filter((each) => each !== null);
            assert.equal(sent.length, 1);
            assert.deepEqual(
                [sent[0]!.status, sent[0]!.submittedAt, sent[0]!.heldAt, sent[0]!.collectOn],
                ['SUBMITTED', takenAt, takenAt, '2026-02-22'],
            );
            assert.deepEqual(await collections.findById(id), sent[0]);
            assert.ok(!(await collections.listPlanned({ limit: 50 })).includes(id));
        });

        // @requirement SC-PRIC-080
        test('attempts planned at the same time for one invoice: one is, and the others are told', async (t) => {
            const account = await collectable(t, 'tenant-collect-plan-race');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;

            const planned = await Promise.all(
                Array.from({ length: 5 }, () => collections.plan(planOf(invoiceId!))),
            );

            assert.equal(planned.filter((each) => each !== null).length, 1);
            assert.equal((await collections.listByInvoice(invoiceId!)).length, 1);
        });

        // @requirement SC-PRIC-036
        test('a planned attempt is taken up in the invoice’s turn: a second waits for the first transaction, then is told', async (t) => {
            const { adapter } = harness;
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no pessimistic-locking capability');
                return;
            }
            const account = await collectable(t, 'tenant-collect-plan-turn');
            if (!account) return;
            const { collections, ids } = account;
            const planned = await collections.plan(planOf(ids[0]!));

            const sections: Array<{ enter: number; exit: number; taken: boolean }> = [];
            const critical = (tx: TransactionContext) =>
                collections.submitPlanned(planned!.id, STARTED_AT, tx).then(async (taken) => {
                    const enter = Date.now();
                    await sleep(LOCK_HOLD_MS);
                    sections.push({ enter, exit: Date.now(), taken: taken !== null });
                });

            await Promise.all([
                adapter.transactionRunner.run(critical),
                adapter.transactionRunner.run(critical),
            ]);

            sections.sort((a, b) => a.enter - b.enter);
            assert.deepEqual(
                sections.map((each) => each.taken),
                [true, false],
            );
            assert.ok(
                sections[1]!.enter >= sections[0]!.exit,
                'the second was decided before the first transaction ended',
            );
        });

        // @requirement SC-PRIC-080
        test('a plan that follows an attempt another has come after since is refused', async (t) => {
            const account = await collectable(t, 'tenant-collect-plan-stale');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;
            const first = await collections.startAttempt(attemptOf(invoiceId!));
            await collections.recordOutcome(first!.id, FAILURE, STARTED_AT);
            const second = await collections.plan(planOf(invoiceId!, { after: 1 }));
            await collections.submitPlanned(second!.id, STARTED_AT);
            await collections.recordOutcome(second!.id, FAILURE, STARTED_AT);

            assert.equal(
                await collections.plan(planOf(invoiceId!, { after: 1 })),
                null,
                'a plan made from the first failure was written after the second',
            );
            assert.equal((await collections.plan(planOf(invoiceId!, { after: 2 })))?.attempt, 3);
        });

        // @requirement SC-PRIC-028
        test('a planned direct debit is announced once, for the day its announcement names', async (t) => {
            const account = await collectable(t, 'tenant-collect-announce');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;
            const planned = await collections.plan(
                planOf(invoiceId!, { paymentMethodType: 'sepa_debit' }),
            );
            const announcedAt = new Date('2026-02-15T05:20:00.000Z');

            assert.equal(await collections.announce(planned!.id, '2026-03-01', announcedAt), true);
            assert.equal(
                await collections.announce(planned!.id, '2026-03-02', new Date()),
                false,
                'an announcement was recorded twice',
            );
            const announced = await collections.findById(planned!.id);
            assert.deepEqual(
                [announced!.status, announced!.collectOn, announced!.announcedAt],
                ['SCHEDULED', '2026-03-01', announcedAt],
            );

            await collections.submitPlanned(planned!.id, new Date('2026-03-01T05:20:00.000Z'));
            const other = await collectable(t, 'tenant-collect-announce-sent');
            if (!other) return;
            const sent = await collections.startAttempt(attemptOf(other.ids[0]!));
            assert.equal(await collections.announce(sent!.id, '2026-03-01', announcedAt), false);
        });

        // @requirement SC-PRIC-082
        test('a planned attempt is withdrawn once, is never sent, and the invoice can be planned again', async (t) => {
            const account = await collectable(t, 'tenant-collect-withdraw');
            if (!account) return;
            const { collections, ids } = account;
            const [invoiceId] = ids;
            const planned = await collections.plan(planOf(invoiceId!));
            const withdrawnAt = new Date('2026-02-10T05:20:00.000Z');

            assert.equal(await collections.withdraw(planned!.id, withdrawnAt), true);
            assert.equal(await collections.withdraw(planned!.id, new Date()), false);
            assert.equal(await collections.submitPlanned(planned!.id, new Date()), null);
            const withdrawn = await collections.findById(planned!.id);
            assert.deepEqual(
                [withdrawn!.status, withdrawn!.resolvedAt, withdrawn!.submittedAt],
                ['WITHDRAWN', withdrawnAt, null],
            );

            const again = await collections.plan(
                planOf(invoiceId!, { after: 1, collectOn: '2026-02-11' }),
            );
            assert.equal(again?.attempt, 2);
            const sent = await collections.startAttempt(attemptOf(ids[0]!));
            assert.equal(sent, null, 'a first attempt was started beside a planned one');
        });

        // @requirement SC-PRIC-080
        test('the failed attempts whose follow-up is not recorded are listed, page by page, and no others', async (t) => {
            const account = await collectable(t, 'tenant-collect-to-follow-up', [{}, {}, {}]);
            if (!account) return;
            const { collections, ids } = account;
            const [failed, followed, open] = await Promise.all(
                ids.map((invoiceId) => collections.startAttempt(attemptOf(invoiceId))),
            );
            await collections.recordOutcome(failed!.id, FAILURE, STARTED_AT);
            await collections.recordOutcome(followed!.id, FAILURE, STARTED_AT);
            await collections.markFollowedUp(followed!.id, STARTED_AT);
            const mine = (found: string[]) =>
                found.filter((id) => [failed, followed, open].some((a) => a!.id === id));

            const first = await collections.listToFollowUp({ limit: 1 });
            const rest = await collections.listToFollowUp({ limit: 50, after: first.at(-1) });

            assert.deepEqual(mine([...first, ...rest]), [failed!.id]);
            assert.equal(first.length, 1);
        });

        // @requirement SC-PRIC-082
        test('the invoices another payment method can collect are those whose last attempt failed and was followed up, or was withdrawn, and no others', async (t) => {
            const account = await collectable(t, 'tenant-collect-again', [{}, {}, {}, {}, {}, {}]);
            if (!account) return;
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            if (!methods) return;
            const { collections, ids, subscriberId } = account;
            const { method: inUse } = await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_in_use', '2026-02-02T10:00:00.000Z'),
            );
            const [replaced, untold, stillInUse, withdrawn, open, retried] = ids;
            const failed = async (invoiceId: string, paymentMethodId: string, followed = true) => {
                const attempt = await collections.startAttempt({
                    ...attemptOf(invoiceId),
                    paymentMethodId,
                });
                await collections.recordOutcome(attempt!.id, FAILURE, STARTED_AT);
                if (followed) await collections.markFollowedUp(attempt!.id, STARTED_AT);
                return attempt!;
            };
            await failed(replaced!, 'payment-method-old');
            await failed(untold!, 'payment-method-old', false);
            await failed(stillInUse!, inUse.id);
            const plan = await collections.plan(planOf(withdrawn!));
            await collections.withdraw(plan!.id, STARTED_AT);
            await collections.startAttempt(attemptOf(open!));
            await failed(retried!, 'payment-method-old');
            await collections.plan(planOf(retried!, { after: 1 }));
            const mine = (found: string[]) => found.filter((id) => ids.includes(id));

            const first = await collections.listCollectableAgain({ limit: 1 });
            const rest = await collections.listCollectableAgain({ limit: 50, after: first.at(-1) });

            assert.deepEqual(mine([...first, ...rest]), [replaced!, withdrawn!].sort());
            assert.equal(first.length, 1);
        });

        // @requirement SC-PRIC-080
        test('what follows a failure is recorded once, and only for a failure', async (t) => {
            const account = await collectable(t, 'tenant-collect-follow-up', [{}, {}]);
            if (!account) return;
            const { collections, ids } = account;
            const failed = await collections.startAttempt(attemptOf(ids[0]!));
            await collections.recordOutcome(failed!.id, FAILURE, STARTED_AT);
            const open = await collections.startAttempt(attemptOf(ids[1]!));
            const followedUpAt = new Date('2026-02-01T05:30:00.000Z');

            const marked = await Promise.all(
                Array.from({ length: 3 }, () =>
                    collections.markFollowedUp(failed!.id, followedUpAt),
                ),
            );

            assert.equal(marked.filter(Boolean).length, 1);
            assert.deepEqual((await collections.findById(failed!.id))!.followedUpAt, followedUpAt);
            assert.equal(await collections.markFollowedUp(open!.id, followedUpAt), false);
            assert.equal((await collections.findById(open!.id))!.followedUpAt, null);
        });

        /** An issued invoice and the archive to keep its document in. Null without an archive. */
        async function anArchive(t: TestContext, tenantId: string) {
            const archive = harness.adapter.invoiceArchive;
            if (!archive || !CONTRACT_GAPS.invoiceArchive.present(harness)) {
                missing(t, 'invoiceArchive');
                return null;
            }
            const account = await issuedInvoices(t, tenantId, 2);
            if (!account) return null;
            // Every byte value, the zero byte among them, and more than one page of a driver's buffer.
            const content = new Uint8Array(70_000).map((_, index) => index % 256);
            const documentOf = (invoiceId: string, checksum = CHECKSUM, bytes = content) => ({
                invoiceId,
                checksum,
                mediaType: 'application/pdf',
                fileName: `${invoiceId}.pdf`,
                content: bytes,
                archivedAt: new Date('2026-02-01T05:17:00.000Z'),
            });
            return { ...account, archive, content, documentOf };
        }

        // @requirement SC-AUD-014
        test('an archived document reads back byte for byte', async (t) => {
            const account = await anArchive(t, 'tenant-archive-bytes');
            if (!account) return;
            const { archive, issued, documentOf } = account;
            const [invoice] = issued;

            await archive.store(documentOf(invoice!.id));
            const read = await archive.read(invoice!.id);

            assert.ok(read);
            assert.deepEqual(read, documentOf(invoice!.id));
            assert.ok(read.content instanceof Uint8Array);
            assert.equal(await archive.read(issued[1]!.id), null);
        });

        // @requirement SC-AUD-019
        test('a document stored again is the same write, and another one for the invoice is refused', async (t) => {
            const account = await anArchive(t, 'tenant-archive-once');
            if (!account) return;
            const { archive, issued, documentOf } = account;
            const [invoice] = issued;
            await archive.store(documentOf(invoice!.id));

            await archive.store(documentOf(invoice!.id));
            await assert.rejects(
                archive.store(documentOf(invoice!.id, OTHER_CHECKSUM, new Uint8Array([1, 2, 3]))),
                refusedAs(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED, {
                    invoiceId: invoice!.id,
                    recorded: CHECKSUM,
                    rendered: OTHER_CHECKSUM,
                }),
            );

            assert.deepEqual(await archive.read(invoice!.id), documentOf(invoice!.id));
        });

        test('documents stored for one invoice at the same time are kept once', async (t) => {
            const account = await anArchive(t, 'tenant-archive-race');
            if (!account) return;
            const { archive, issued, documentOf } = account;
            const [invoice] = issued;

            await Promise.all(
                Array.from({ length: 4 }, () => archive.store(documentOf(invoice!.id))),
            );

            assert.deepEqual(await archive.read(invoice!.id), documentOf(invoice!.id));
        });

        test('a document for an invoice that does not exist is refused', async (t) => {
            const account = await anArchive(t, 'tenant-archive-orphan');
            if (!account) return;

            await assert.rejects(account.archive.store(account.documentOf(NO_SUCH_VERSION)));
            assert.equal(await account.archive.read(NO_SUCH_VERSION), null);
        });

        // -------------------------------------------------------------
        // Payments — recorded once, settling their invoice; credits paid out
        // -------------------------------------------------------------

        const PAID_AT = new Date('2026-02-01T05:30:00.000Z');

        /** A treatment without tax, so an invoice totals what its lines do. */
        const UNTAXED: TaxTreatment = {
            kind: 'reverse-charge',
            rate: 0,
            note: 'Steuerschuldnerschaft des Leistungsempfängers',
            adapter: { name: '@saasicat/tax-de', version: '1.0.0-rc.25' },
        };

        /**
         * A subscriber's invoices to collect, each with its first attempt
         * started as a run starts it, and what records the payments. Null where
         * the adapter provides no payments.
         */
        async function payable(t: TestContext, tenantId: string, count = 1) {
            const payments = harness.adapter.subscriberPaymentRepository;
            if (!payments || !CONTRACT_GAPS.subscriberPayments.present(harness)) {
                missing(t, 'subscriberPayments');
                return null;
            }
            const account = await collectable(
                t,
                tenantId,
                Array.from({ length: count }, () => ({})),
            );
            if (!account) return null;
            const attempts: InvoiceCollectionRecord[] = [];
            const grosses: number[] = [];
            for (const id of account.ids) {
                const attempt = await account.collections.startAttempt(attemptOf(id));
                assert.ok(attempt, 'an attempt was not started');
                attempts.push(attempt);
                const invoice = await account.invoices.findById(id);
                assert.ok(invoice, 'an invoice was not issued');
                grosses.push(invoice.totalGross);
            }
            /** The payment the gateway confirmed for `attempt`, under `gatewayRef`. */
            const paymentOf = (
                attempt: InvoiceCollectionRecord,
                gatewayRef: string,
                amount: number,
                overrides: Partial<NewSubscriberPayment> = {},
            ): NewSubscriberPayment => ({
                invoiceId: attempt.invoiceId,
                collectionId: attempt.id,
                gatewayAccount: 'stripe-main',
                provider: 'stripe',
                gatewayRef,
                amount,
                currency: 'EUR',
                at: PAID_AT,
                ...overrides,
            });
            return { ...account, payments, attempts, grosses, paymentOf };
        }

        /** A refund the gateway reports of payment `paymentRef`. */
        const refundOf = (
            gatewayRef: string,
            paymentRef: string,
            amount: number,
            status: ReportedSubscriberRefund['status'] = 'PENDING',
            at = new Date('2026-02-10T09:00:00.000Z'),
        ): ReportedSubscriberRefund => ({
            gatewayAccount: 'stripe-main',
            gatewayRef,
            paymentRef,
            amount,
            currency: 'EUR',
            status,
            at,
        });

        /** What each of the subscriber's credits still owes, the oldest first. */
        async function openCredits(payments: SubscriberPaymentRepository, subscriberId: string) {
            return (await payments.listCredits(subscriberId)).map(({ credit, open }) => ({
                origin: credit.origin.kind,
                amount: credit.amount,
                open,
            }));
        }

        // @requirement SC-PRIC-029
        // @requirement SC-PRIC-036
        test('a payment is recorded once under its gateway account and reference, and settles what its invoice owes', async (t) => {
            const account = await payable(t, 'tenant-pay-once');
            if (!account) return;
            const { payments, attempts, grosses, paymentOf, ids } = account;

            const first = await payments.recordPayment(
                paymentOf(attempts[0]!, 'pi_1', grosses[0]!),
            );
            assert.ok(first, 'the payment was not recorded');
            assert.equal(first.settled, grosses[0]);
            assert.equal(first.credit, null);
            assert.equal(first.payment.subscriberId, account.subscriberId);
            assert.equal(await payments.owedBy(ids[0]!), 0);

            assert.equal(
                await payments.recordPayment(paymentOf(attempts[0]!, 'pi_1', grosses[0]!)),
                null,
                'a payment reported again under its reference was recorded twice',
            );
            assert.deepEqual(
                (await payments.listPaymentsByInvoice(ids[0]!)).map((each) => each.gatewayRef),
                ['pi_1'],
            );
            assert.equal(
                (await payments.findPaymentByRef('stripe-main', 'pi_1'))?.id,
                first.payment.id,
            );
            assert.deepEqual(await payments.findPaymentById(first.payment.id), first.payment);
            assert.equal(await payments.findPaymentById(NO_SUCH_VERSION), null);
            assert.equal(await payments.findPaymentByRef('stripe-other', 'pi_1'), null);
        });

        // @requirement SC-PRIC-029
        test('two reports of one payment at the same moment record it once, and settle its invoice once', async (t) => {
            const account = await payable(t, 'tenant-pay-race');
            if (!account) return;
            const { payments, attempts, grosses, paymentOf, ids } = account;
            const payment = paymentOf(attempts[0]!, 'pi_race', grosses[0]!);

            const outcomes = await Promise.all(
                Array.from({ length: 4 }, () => payments.recordPayment(payment)),
            );

            assert.equal(outcomes.filter(Boolean).length, 1, 'not exactly one report recorded it');
            assert.equal(await payments.owedBy(ids[0]!), 0);
            assert.deepEqual(await openCredits(payments, account.subscriberId), []);
        });

        // @requirement SC-PRIC-036
        test('two payments of one invoice at the same moment settle it once, and the other is a credit', async (t) => {
            const account = await payable(t, 'tenant-pay-two');
            if (!account) return;
            const { payments, attempts, grosses, paymentOf, ids } = account;

            const outcomes = await Promise.all([
                payments.recordPayment(paymentOf(attempts[0]!, 'pi_a', grosses[0]!)),
                payments.recordPayment(paymentOf(attempts[0]!, 'pi_b', grosses[0]!)),
            ]);

            assert.deepEqual(
                outcomes.map((outcome) => outcome?.settled).sort((a, b) => (a ?? 0) - (b ?? 0)),
                [0, grosses[0]],
                'both payments settled the invoice',
            );
            assert.equal(await payments.owedBy(ids[0]!), 0);
            assert.deepEqual(
                (await openCredits(payments, account.subscriberId)).map((credit) => credit.amount),
                [grosses[0]],
            );
        });

        // @requirement SC-PRIC-029
        test('an invoice a payment covers is collected no further: nothing planned or sent for it, and not listed to collect again', async (t) => {
            const account = await payable(t, 'tenant-pay-covered', 2);
            if (!account) return;
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            if (!methods) return;
            const { collections, payments, attempts, grosses, paymentOf, ids, subscriberId } =
                account;
            await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_replaced', '2026-02-02T10:00:00.000Z'),
            );
            // Both first attempts failed: the first invoice is planned once
            // more, the second followed up and waits for another payment method.
            for (const attempt of attempts) {
                await collections.recordOutcome(attempt.id, FAILURE, PAID_AT);
            }
            const planned = await collections.plan(planOf(ids[0]!, { after: 1 }));
            assert.ok(planned, 'the premise: a retry is planned');
            await collections.markFollowedUp(attempts[1]!.id, PAID_AT);
            assert.ok(
                (await collections.listCollectableAgain({ limit: 50 })).includes(ids[1]!),
                'the premise: another payment method can collect the second',
            );

            for (const [index, attempt] of attempts.entries()) {
                await payments.recordPayment(
                    paymentOf(attempt, `pi_covered_${index}`, grosses[index]!),
                );
            }

            assert.equal(await collections.submitPlanned(planned!.id, PAID_AT), null);
            assert.equal((await collections.findById(planned!.id))?.status, 'SCHEDULED');
            assert.equal(await collections.withdraw(planned!.id, PAID_AT), true);
            assert.equal(await collections.plan(planOf(ids[0]!, { after: 2 })), null);
            assert.ok(!(await collections.listCollectableAgain({ limit: 50 })).includes(ids[1]!));
        });

        // @requirement SC-PRIC-029
        test('a request that never reached the gateway is settled rather than sent again, where its invoice was paid meanwhile', async (t) => {
            const account = await payable(t, 'tenant-pay-abandon', 3);
            if (!account) return;
            const { collections, payments, attempts, grosses, paymentOf } = account;
            const [paid, owing, reported] = attempts;
            assert.equal(await collections.abandonPaid(paid!.id, PAID_AT), 'resend', 'it owes');

            await payments.recordPayment(paymentOf(paid!, 'pi_elsewhere', grosses[0]!));
            // A report settles the third while its invoice still owes.
            await collections.recordOutcome(reported!.id, FAILURE, PAID_AT);

            assert.equal(await collections.abandonPaid(paid!.id, PAID_AT), 'abandoned');
            assert.equal(await collections.abandonPaid(paid!.id, PAID_AT), 'settled', 'twice');
            assert.equal(await collections.abandonPaid(owing!.id, PAID_AT), 'resend');
            assert.equal(await collections.abandonPaid(reported!.id, PAID_AT), 'settled');
            assert.equal(
                (await collections.findById(reported!.id))?.failureCode,
                FAILURE.gatewayCode,
            );
            const settled = await collections.findById(paid!.id);
            assert.deepEqual(
                [
                    settled?.status,
                    settled?.failureReason,
                    settled?.failureCode,
                    settled?.paymentRef,
                    settled?.resolvedAt?.getTime(),
                ],
                ['FAILED', 'other', 'saasicat_invoice_paid', null, PAID_AT.getTime()],
            );
            assert.equal((await collections.findById(owing!.id))?.status, 'SUBMITTED');
        });

        // @requirement SC-PRIC-029
        test('a failure still being recorded while the run decides about a lost request is found, and the request is not sent again', async (t) => {
            const account = await payable(t, 'tenant-pay-abandon-race', 1);
            if (!account) return;
            const { collections, attempts } = account;
            const [attempt] = attempts;
            let release = () => {};
            const holding = new Promise<void>((resolve) => {
                release = resolve;
            });
            let signalWritten = () => {};
            const written = new Promise<void>((resolve) => {
                signalWritten = resolve;
            });
            const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

            // The gateway's failure is recorded — outside the invoice's turn,
            // as every answer but a success is — and its transaction kept
            // open, the attempt written and locked, while the run decides.
            const reported = harness.adapter.transactionRunner.run(async (tx) => {
                const settled = await collections.recordOutcome(attempt!.id, FAILURE, PAID_AT, tx);
                signalWritten();
                await holding;
                return settled;
            });
            // A failing recording rejects here rather than leave the wait open.
            await Promise.race([written, reported]);
            const decided = collections.abandonPaid(attempt!.id, PAID_AT);
            // Time for the decision to reach its write and wait on the lock;
            // whenever it gets there, it finds the failure.
            await pause(200);
            release();

            assert.equal(await reported, true);
            assert.equal(await decided, 'settled', 'a request the gateway answered was sent again');
            assert.equal((await collections.findById(attempt!.id))?.status, 'FAILED');
        });

        // @requirement SC-PRIC-083
        test('what a payment brings beyond what its invoice owes is a credit, one cent included', async (t) => {
            const account = await payable(t, 'tenant-pay-beyond', 2);
            if (!account) return;
            const { payments, attempts, grosses, paymentOf, ids } = account;

            const cent = await payments.recordPayment(
                paymentOf(attempts[0]!, 'pi_cent', sumToCents(grosses[0]!, 0.01)),
            );
            assert.equal(cent?.settled, grosses[0]);
            assert.equal(cent?.credit?.amount, 0.01);
            assert.deepEqual(cent?.credit?.origin, {
                kind: 'payment',
                paymentId: cent?.payment.id,
            });

            const short = await payments.recordPayment(
                paymentOf(attempts[1]!, 'pi_short', sumToCents(grosses[1]!, -0.01)),
            );
            assert.equal(short?.credit, null);
            assert.equal(await payments.owedBy(ids[1]!), 0.01);

            const second = await payments.recordPayment(paymentOf(attempts[1]!, 'pi_rest', 0.01));
            assert.equal(second?.settled, 0.01);
            const beyond = await payments.recordPayment(
                paymentOf(attempts[1]!, 'pi_beyond', 5, {
                    at: new Date('2026-02-02T05:30:00.000Z'),
                }),
            );
            assert.equal(beyond?.settled, 0, 'an invoice that owes nothing was settled again');
            assert.equal(beyond?.credit?.amount, 5);
            assert.deepEqual(await openCredits(payments, account.subscriberId), [
                { origin: 'payment', amount: 0.01, open: 0.01 },
                { origin: 'payment', amount: 5, open: 5 },
            ]);
        });

        test('a payment in another currency than its invoice, or for an invoice that does not exist, is refused', async (t) => {
            const account = await payable(t, 'tenant-pay-refused');
            if (!account) return;
            const { payments, attempts, grosses, paymentOf, ids } = account;

            await assert.rejects(
                payments.recordPayment(
                    paymentOf(attempts[0]!, 'pi_usd', grosses[0]!, { currency: 'USD' }),
                ),
            );
            await assert.rejects(
                payments.recordPayment(
                    paymentOf(attempts[0]!, 'pi_none', grosses[0]!, { invoiceId: NO_SUCH_VERSION }),
                ),
            );
            assert.equal(await payments.owedBy(ids[0]!), grosses[0]);
            assert.equal(await payments.owedBy(NO_SUCH_VERSION), null);
        });

        // @requirement SC-PRIC-083
        test('an invoice whose total is negative is credited to its subscriber once, and listed until it is', async (t) => {
            const account = await payable(t, 'tenant-pay-negative');
            if (!account) return;
            const { payments, ids } = account;
            const [credit] = await account.record({
                ...monthly(5),
                origin: 'credit',
                amountNet: -40,
            });
            const negative = await account.invoices.issue(account.invoiceOf([credit!]));
            assert.ok(negative.totalGross < 0, 'the invoice does not total below nothing');

            const listed = await payments.listUncredited({ limit: 10 });
            assert.ok(listed.includes(negative.id), 'the negative invoice is not listed');
            assert.ok(!listed.includes(ids[0]!), 'an invoice that asks for money is listed');

            const written = await payments.creditInvoice(negative.id, PAID_AT);
            assert.equal(written?.amount, -negative.totalGross);
            assert.deepEqual(written?.origin, { kind: 'invoice', invoiceId: negative.id });
            assert.equal(await payments.creditInvoice(negative.id, PAID_AT), null);
            assert.equal(await payments.creditInvoice(ids[0]!, PAID_AT), null);
            assert.ok(!(await payments.listUncredited({ limit: 10 })).includes(negative.id));
            await assert.rejects(payments.creditInvoice(NO_SUCH_VERSION, PAID_AT));
        });

        /**
         * A subscriber with two credits — the older from an invoice totalling
         * −40.00, the newer of 5.00 that payment `pi_over` left — and that
         * payment, which a refund can pay back.
         */
        async function withTwoCredits(t: TestContext, tenantId: string) {
            const account = await payable(t, tenantId);
            if (!account) return null;
            const { payments, attempts, grosses, paymentOf } = account;
            const [credit] = await account.record({
                ...monthly(5),
                origin: 'credit',
                amountNet: -40,
            });
            // Without tax, so the credit is 40.00 to the cent.
            const negative = await account.invoices.issue(
                account.invoiceOf([credit!], {}, UNTAXED),
            );
            const older = await payments.creditInvoice(
                negative.id,
                new Date('2026-01-20T00:00:00.000Z'),
            );
            assert.ok(older, 'the older credit was not written');
            const over = await payments.recordPayment(
                paymentOf(attempts[0]!, 'pi_over', sumToCents(grosses[0]!, 5)),
            );
            assert.equal(over?.credit?.amount, 5);
            return { ...account, older, newer: over!.credit! };
        }

        // @requirement SC-PRIC-083
        // @requirement SC-PRIC-031
        test('a refund pays out the credit its payment left first, then the oldest, and what none owes matches nothing', async (t) => {
            const account = await withTwoCredits(t, 'tenant-refund-order');
            if (!account) return;
            const { payments, subscriberId } = account;

            const recorded = await payments.recordRefund(refundOf('re_1', 'pi_over', 50.01));

            assert.equal(recorded.outcome, 'recorded');
            assert.ok(recorded.outcome === 'recorded');
            assert.deepEqual(recorded.parts, [
                { creditId: account.newer.id, amount: 5 },
                { creditId: account.older.id, amount: 40 },
            ]);
            assert.equal(recorded.unmatched, 5.01);
            assert.equal(recorded.refund.status, 'PENDING');
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'invoice', amount: 40, open: 0 },
                { origin: 'payment', amount: 5, open: 0 },
            ]);
        });

        // @requirement SC-PRIC-083
        test('a refund reported again changes nothing paid out, and settling it only restates it', async (t) => {
            const account = await withTwoCredits(t, 'tenant-refund-again');
            if (!account) return;
            const { payments, subscriberId } = account;
            await payments.recordRefund(refundOf('re_1', 'pi_over', 3));

            const again = await payments.recordRefund(refundOf('re_1', 'pi_over', 3));
            const settled = await payments.recordRefund(
                refundOf('re_1', 'pi_over', 3, 'SUCCEEDED'),
            );

            assert.equal(again.outcome, 'unchanged');
            assert.equal(settled.outcome, 'unchanged');
            assert.ok(settled.outcome === 'unchanged');
            assert.equal(settled.refund.status, 'SUCCEEDED');
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'invoice', amount: 40, open: 40 },
                { origin: 'payment', amount: 5, open: 2 },
            ]);
        });

        // @requirement SC-PRIC-083
        test('a refund that fails or is canceled gives back what it paid out, once, and nothing after', async (t) => {
            const account = await withTwoCredits(t, 'tenant-refund-fails');
            if (!account) return;
            const { payments, subscriberId } = account;
            await payments.recordRefund(refundOf('re_1', 'pi_over', 12));
            const failedAt = new Date('2026-02-20T09:00:00.000Z');

            const failed = await payments.recordRefund(
                refundOf('re_1', 'pi_over', 12, 'FAILED', failedAt),
            );
            assert.equal(failed.outcome, 'given-back');
            assert.ok(failed.outcome === 'given-back');
            assert.deepEqual(
                new Map(failed.parts.map((part) => [part.creditId, part.amount])),
                new Map([
                    [account.newer.id, 5],
                    [account.older.id, 7],
                ]),
            );
            assert.equal(failed.refund.endedAt?.getTime(), failedAt.getTime());
            assert.equal(
                (await payments.recordRefund(refundOf('re_1', 'pi_over', 12, 'FAILED'))).outcome,
                'unchanged',
            );
            const afterTheEnd = await payments.recordRefund(
                refundOf('re_1', 'pi_over', 12, 'SUCCEEDED'),
            );
            assert.equal(afterTheEnd.outcome, 'unchanged', 'a refund that ended paid out again');
            assert.ok(afterTheEnd.outcome === 'unchanged');
            assert.equal(afterTheEnd.refund.status, 'FAILED', 'a refund that ended was restated');
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'invoice', amount: 40, open: 40 },
                { origin: 'payment', amount: 5, open: 5 },
            ]);

            await payments.recordRefund(refundOf('re_2', 'pi_over', 1));
            const canceled = await payments.recordRefund(
                refundOf('re_2', 'pi_over', 1, 'CANCELED'),
            );
            assert.equal(canceled.outcome, 'given-back');
        });

        // @requirement SC-PRIC-083
        test('a refund in another currency than the payment it pays back is refused, and pays nothing out', async (t) => {
            const account = await withTwoCredits(t, 'tenant-refund-currency');
            if (!account) return;
            const { payments, subscriberId } = account;

            await assert.rejects(
                payments.recordRefund({ ...refundOf('re_usd', 'pi_over', 5), currency: 'USD' }),
            );

            assert.deepEqual(
                (await openCredits(payments, subscriberId)).map((credit) => credit.open),
                [40, 5],
            );
        });

        // @requirement SC-PRIC-083
        test('a refund first reported as failed pays nothing out, and one of an unknown payment writes nothing', async (t) => {
            const account = await withTwoCredits(t, 'tenant-refund-ended');
            if (!account) return;
            const { payments, subscriberId } = account;

            const ended = await payments.recordRefund(refundOf('re_1', 'pi_over', 12, 'FAILED'));
            assert.equal(ended.outcome, 'recorded');
            assert.ok(ended.outcome === 'recorded');
            assert.deepEqual(ended.parts, []);
            assert.equal(ended.unmatched, 0);

            assert.deepEqual(await payments.recordRefund(refundOf('re_2', 'pi_unknown', 12)), {
                outcome: 'unknown-payment',
            });
            assert.deepEqual(
                (await openCredits(payments, subscriberId)).map((credit) => credit.open),
                [40, 5],
            );
        });

        // @requirement SC-PRIC-083
        test('two refunds at the same moment never pay one credit out twice', async (t) => {
            const account = await withTwoCredits(t, 'tenant-refund-race');
            if (!account) return;
            const { payments, subscriberId } = account;

            const outcomes = await Promise.all([
                payments.recordRefund(refundOf('re_a', 'pi_over', 45)),
                payments.recordRefund(refundOf('re_b', 'pi_over', 45)),
            ]);

            const unmatched = outcomes.map((outcome) =>
                outcome.outcome === 'recorded' ? outcome.unmatched : NaN,
            );
            assert.deepEqual(
                [...unmatched].sort((a, b) => a - b),
                [0, 45],
                'one refund takes both credits and the other matches nothing',
            );
            assert.deepEqual(
                (await openCredits(payments, subscriberId)).map((credit) => credit.open),
                [0, 0],
            );
        });

        // @requirement SC-PRIC-083
        test('a refund waits for one still being recorded, and then finds the credits it took', async (t) => {
            const account = await withTwoCredits(t, 'tenant-refund-waits');
            if (!account) return;
            const { payments, subscriberId } = account;
            let release = () => {};
            const holding = new Promise<void>((resolve) => {
                release = resolve;
            });
            const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

            // The first refund is recorded and its transaction kept open, with
            // whatever it holds, while the second is reported.
            const first = harness.adapter.transactionRunner.run(async (tx) => {
                const recorded = await payments.recordRefund(refundOf('re_a', 'pi_over', 45), tx);
                await holding;
                return recorded;
            });
            await pause(100);
            const second = payments.recordRefund(refundOf('re_b', 'pi_over', 45));
            await pause(200);
            release();
            const [a, b] = await Promise.all([first, second]);

            assert.ok(a.outcome === 'recorded' && b.outcome === 'recorded');
            assert.equal(a.unmatched, 0);
            assert.equal(
                b.unmatched,
                45,
                'the second refund paid out a credit the first had taken',
            );
            assert.deepEqual(
                (await openCredits(payments, subscriberId)).map((credit) => credit.open),
                [0, 0],
            );
        });

        // @requirement SC-PRIC-083
        test('a payout is recorded against a credit up to what it still owes, and no further', async (t) => {
            const account = await withTwoCredits(t, 'tenant-payout');
            if (!account) return;
            const { payments, subscriberId, older } = account;
            const payout = (amount: number, creditId = older.id): NewSubscriberPayout => ({
                creditId,
                amount,
                reference: 'TRF-2026-0042',
                paidOn: '2026-03-03',
                note: 'Account no longer at the gateway',
                recordedBy: 'operator-1',
                at: new Date('2026-03-03T10:00:00.000Z'),
            });

            assert.deepEqual(await payments.recordPayout(payout(40.01)), {
                outcome: 'exceeds-open',
                open: 40,
            });
            const recorded = await payments.recordPayout(payout(40));
            assert.equal(recorded.outcome, 'recorded');
            assert.ok(recorded.outcome === 'recorded');
            assert.equal(recorded.open, 0);
            assert.equal(recorded.entry.kind, 'PAYOUT');
            assert.equal(recorded.entry.reference, 'TRF-2026-0042');
            assert.equal(recorded.entry.paidOn, '2026-03-03');
            assert.equal(recorded.entry.recordedBy, 'operator-1');
            assert.equal(recorded.entry.note, 'Account no longer at the gateway');
            assert.deepEqual(await payments.recordPayout(payout(0.01)), {
                outcome: 'exceeds-open',
                open: 0,
            });
            assert.deepEqual(await payments.recordPayout(payout(1, NO_SUCH_VERSION)), {
                outcome: 'unknown-credit',
            });

            const [standing] = await payments.listCredits(subscriberId);
            assert.equal(standing?.open, 0);
            assert.deepEqual(
                standing?.entries.map((entry) => [entry.kind, entry.amount]),
                [['PAYOUT', 40]],
            );
        });

        // @requirement SC-PRIC-083
        test('two payouts at the same moment never pay one credit out twice', async (t) => {
            const account = await withTwoCredits(t, 'tenant-payout-race');
            if (!account) return;
            const { payments, older } = account;
            const payout = (reference: string): NewSubscriberPayout => ({
                creditId: older.id,
                amount: 40,
                reference,
                paidOn: '2026-03-03',
                note: null,
                recordedBy: 'operator-1',
                at: new Date('2026-03-03T10:00:00.000Z'),
            });

            const outcomes = await Promise.all([
                payments.recordPayout(payout('TRF-1')),
                payments.recordPayout(payout('TRF-2')),
            ]);

            assert.deepEqual(outcomes.map((outcome) => outcome.outcome).sort(), [
                'exceeds-open',
                'recorded',
            ]);
        });

        // @requirement SC-PRIC-029
        test('an attempt is found by the key the gateway keeps with it', async (t) => {
            const account = await payable(t, 'tenant-pay-key');
            if (!account) return;
            const { collections, attempts } = account;

            assert.equal(
                (await collections.findByKey(attempts[0]!.attemptKey))?.id,
                attempts[0]!.id,
            );
            assert.equal(await collections.findByKey('saasicat:collect:nothing:1'), null);
        });

        // @requirement SC-PRIC-029
        test('a success reported for an attempt recorded as failed settles it, and withdraws what was planned after it', async (t) => {
            const account = await payable(t, 'tenant-pay-late');
            if (!account) return;
            const { collections, attempts, ids } = account;
            const [first] = attempts;
            await collections.recordOutcome(first!.id, FAILURE, PAID_AT);
            const planned = await collections.plan(planOf(ids[0]!, { after: 1 }));
            assert.ok(planned, 'the retry was not planned');

            const success = {
                status: 'succeeded' as const,
                paymentRef: 'pi_1',
                amountCents: 2368,
                currency: 'EUR',
            };
            assert.equal(await collections.recordOutcome(first!.id, success, PAID_AT), true);
            assert.equal(await collections.recordOutcome(first!.id, success, PAID_AT), false);

            assert.deepEqual(
                (await collections.listByInvoice(ids[0]!)).map((each) => each.status),
                ['SUCCEEDED', 'WITHDRAWN'],
            );
        });

        // @requirement SC-PRIC-029
        test('a success reported for a failed attempt leaves it failed where a later one is on its way', async (t) => {
            const account = await payable(t, 'tenant-pay-late-sent');
            if (!account) return;
            const { collections, attempts, ids } = account;
            const [first] = attempts;
            await collections.recordOutcome(first!.id, FAILURE, PAID_AT);
            const planned = await collections.plan(planOf(ids[0]!, { after: 1 }));
            assert.ok(await collections.submitPlanned(planned!.id, PAID_AT));

            const success = {
                status: 'succeeded' as const,
                paymentRef: 'pi_1',
                amountCents: 2368,
                currency: 'EUR',
            };
            assert.equal(await collections.recordOutcome(first!.id, success, PAID_AT), false);

            assert.deepEqual(
                (await collections.listByInvoice(ids[0]!)).map((each) => each.status),
                ['FAILED', 'SUBMITTED'],
            );
        });

        // -------------------------------------------------------------
        // Reversals — the credit first, then the invoice; given back part
        // for part; what matches nothing is a case to reconcile
        // -------------------------------------------------------------

        const REVERSED_AT = new Date('2026-03-20T09:00:00.000Z');
        const GIVEN_BACK_AT = new Date('2026-05-20T09:00:00.000Z');

        /** A reversal the gateway reports of payment `paymentRef`, each amount in total so far. */
        const reversalOf = (
            gatewayRef: string,
            paymentRef: string,
            withdrawn: number,
            reinstated = 0,
            at = REVERSED_AT,
        ): ReportedSubscriberReversal => ({
            gatewayAccount: 'stripe-main',
            gatewayRef,
            paymentRef,
            currency: 'EUR',
            withdrawn,
            reinstated,
            at,
        });

        /**
         * A subscriber's first invoice collected by `pi_paid`, which brought
         * `beyond` more than the invoice owed: the attempt succeeded, and the
         * payment is recorded with the credit it left.
         */
        async function paidOnce(t: TestContext, tenantId: string, beyond = 0) {
            const account = await payable(t, tenantId);
            if (!account) return null;
            const { collections, payments, attempts, grosses, paymentOf, ids } = account;
            const attempt = attempts[0]!;
            const gross = grosses[0]!;
            const brought = sumToCents(gross, beyond);
            await collections.recordOutcome(
                attempt.id,
                {
                    status: 'succeeded',
                    paymentRef: 'pi_paid',
                    amountCents: Math.round(brought * 100),
                    currency: 'EUR',
                },
                PAID_AT,
            );
            const recorded = await payments.recordPayment(paymentOf(attempt, 'pi_paid', brought));
            assert.ok(recorded, 'the payment was not recorded');
            return { ...account, attempt, gross, brought, recorded, invoiceId: ids[0]! };
        }

        // @requirement SC-PRIC-084
        test('a reversal takes the credit first and opens the invoice by what remains, once however often it is reported', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-full', 20);
            if (!account) return;
            const { payments, subscriberId, gross, brought, invoiceId, recorded } = account;
            const creditId = recorded.credit!.id;

            const reversed = await payments.recordReversal(reversalOf('du_1', 'pi_paid', brought));

            assert.equal(reversed.outcome, 'recorded');
            assert.ok(reversed.outcome === 'recorded' && reversed.withdrawal);
            assert.deepEqual(reversed.withdrawal.credits, [{ creditId, amount: 20 }]);
            assert.deepEqual(reversed.withdrawal.invoices, [{ invoiceId, amount: gross }]);
            assert.equal(reversed.withdrawal.unmatched, 0);
            assert.equal(reversed.reinstatement, null);
            assert.deepEqual(
                [
                    reversed.reversal.amount,
                    reversed.reversal.fromCredit,
                    reversed.reversal.reinstated,
                ],
                [brought, 20, 0],
            );
            assert.equal(await payments.owedBy(invoiceId), gross);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 20, open: 0 },
            ]);

            assert.equal(
                (await payments.recordReversal(reversalOf('du_1', 'pi_paid', brought))).outcome,
                'unchanged',
            );
            assert.equal(await payments.owedBy(invoiceId), gross, 'opened twice');
        });

        // @requirement SC-PRIC-084
        test('a reversal no larger than the credit shrinks the credit alone, and one growing applies only what grew', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-part', 20);
            if (!account) return;
            const { payments, subscriberId, invoiceId } = account;

            const first = await payments.recordReversal(reversalOf('du_1', 'pi_paid', 15));
            assert.ok(first.outcome === 'recorded' && first.withdrawal);
            assert.deepEqual(first.withdrawal.invoices, []);
            assert.equal(await payments.owedBy(invoiceId), 0);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 20, open: 5 },
            ]);

            const grown = await payments.recordReversal(reversalOf('du_1', 'pi_paid', 30.01));
            assert.ok(grown.outcome === 'recorded' && grown.withdrawal);
            assert.deepEqual(
                grown.withdrawal.credits.map((part) => part.amount),
                [5],
            );
            assert.deepEqual(grown.withdrawal.invoices, [{ invoiceId, amount: 10.01 }]);
            assert.equal(await payments.owedBy(invoiceId), 10.01);
        });

        // @requirement SC-PRIC-084
        // @requirement SC-ADM-033
        test('what meets a credit already refunded, or goes beyond the payment, is a case to reconcile', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-refunded', 20);
            if (!account) return;
            const { payments, subscriberId, brought, invoiceId, gross, recorded } = account;
            await payments.recordRefund(refundOf('re_1', 'pi_paid', 20, 'SUCCEEDED'));

            const reversed = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', sumToCents(brought, 5)),
            );

            assert.ok(reversed.outcome === 'recorded' && reversed.withdrawal);
            assert.deepEqual(reversed.withdrawal.credits, []);
            assert.equal(reversed.withdrawal.unmatched, 25);
            assert.deepEqual(
                [
                    reversed.withdrawal.case?.kind,
                    reversed.withdrawal.case?.amount,
                    reversed.withdrawal.case?.reversalId,
                    reversed.withdrawal.case?.paymentId,
                    reversed.withdrawal.case?.gatewayRef,
                ],
                ['REVERSAL_UNMATCHED', 25, reversed.reversal.id, recorded.payment.id, 'du_1'],
            );
            assert.equal(await payments.owedBy(invoiceId), gross);
            assert.deepEqual(
                (await payments.listCases({ state: 'open', subscriberId }, { limit: 10 })).map(
                    (each) => [each.kind, each.amount],
                ),
                [['REVERSAL_UNMATCHED', 25]],
            );
        });

        // @requirement SC-PRIC-084
        test('a reversal of a payment no one recorded is unknown, and one in another currency is refused', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-unknown');
            if (!account) return;
            const { payments, invoiceId } = account;

            assert.deepEqual(await payments.recordReversal(reversalOf('du_1', 'pi_nobody', 10)), {
                outcome: 'unknown-payment',
            });
            await assert.rejects(
                payments.recordReversal({ ...reversalOf('du_2', 'pi_paid', 10), currency: 'USD' }),
            );
            assert.equal(await payments.owedBy(invoiceId), 0);
        });

        // @requirement SC-PRIC-086
        // @requirement SC-ADM-033
        test('what the gateway gives back returns the reversal part for part, and closes its cases', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-won', 20);
            if (!account) return;
            const { payments, subscriberId, brought, invoiceId, recorded } = account;
            await payments.recordPayout({
                creditId: recorded.credit!.id,
                amount: 5,
                reference: 'TRF-1',
                paidOn: '2026-02-20',
                note: null,
                recordedBy: 'operator-1',
                at: PAID_AT,
            });
            const reversed = await payments.recordReversal(reversalOf('du_1', 'pi_paid', brought));
            assert.ok(reversed.outcome === 'recorded' && reversed.withdrawal?.case);
            assert.equal(reversed.withdrawal.unmatched, 5);

            const won = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', brought, brought, GIVEN_BACK_AT),
            );

            assert.ok(won.outcome === 'recorded' && won.reinstatement);
            assert.equal(won.withdrawal, null);
            assert.deepEqual(
                won.reinstatement.closedCases.map((each) => [
                    each.id,
                    each.closedBy,
                    each.closedAt?.getTime(),
                ]),
                [[reversed.withdrawal.case.id, null, GIVEN_BACK_AT.getTime()]],
            );
            assert.ok(won.reinstatement.closedCases[0]?.note);
            assert.deepEqual(won.reinstatement.credits, [
                { creditId: recorded.credit!.id, amount: 15 },
            ]);
            assert.equal(won.reinstatement.credit, null);
            assert.equal(won.reversal.reinstated, brought);
            assert.equal(won.reversal.reinstatedAt?.getTime(), GIVEN_BACK_AT.getTime());
            assert.equal(await payments.owedBy(invoiceId), 0);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 20, open: 15 },
            ]);
            assert.equal(
                (
                    await payments.recordReversal(
                        reversalOf('du_1', 'pi_paid', brought, brought, GIVEN_BACK_AT),
                    )
                ).outcome,
                'unchanged',
            );
        });

        // @requirement SC-PRIC-086
        test('a reversal given back after the invoice was paid again leaves what was paid meanwhile as a credit', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-paid-again');
            if (!account) return;
            const { payments, subscriberId, gross, invoiceId, attempt, paymentOf } = account;
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', gross));
            await payments.recordPayment(paymentOf(attempt, 'pi_again', gross));
            assert.equal(await payments.owedBy(invoiceId), 0, 'the premise: paid again');

            const won = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', gross, gross, GIVEN_BACK_AT),
            );

            assert.ok(won.outcome === 'recorded' && won.reinstatement);
            assert.deepEqual(won.reinstatement.invoices, []);
            assert.deepEqual(won.reinstatement.credit?.origin, {
                kind: 'reversal',
                reversalId: won.reversal.id,
            });
            assert.equal(won.reinstatement.credit?.amount, gross);
            assert.equal(await payments.owedBy(invoiceId), 0);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'reversal', amount: gross, open: gross },
            ]);
        });

        // @requirement SC-PRIC-086
        test('a give-back in part covers what matched nothing first, and the rest returns later', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-in-part', 20);
            if (!account) return;
            const { payments, brought, invoiceId, gross } = account;
            await payments.recordRefund(refundOf('re_1', 'pi_paid', 20, 'SUCCEEDED'));
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', brought));

            const refundedPart = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', brought, 19.99, GIVEN_BACK_AT),
            );
            assert.ok(refundedPart.outcome === 'recorded' && refundedPart.reinstatement);
            assert.deepEqual(
                refundedPart.reinstatement.closedCases,
                [],
                'a cent short closes nothing',
            );
            const covered = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', brought, 20, GIVEN_BACK_AT),
            );
            assert.ok(covered.outcome === 'recorded' && covered.reinstatement);
            assert.equal(covered.reinstatement.closedCases.length, 1);
            assert.equal(await payments.owedBy(invoiceId), gross, 'the invoice still owes');

            await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', brought, brought, GIVEN_BACK_AT),
            );
            assert.equal(await payments.owedBy(invoiceId), 0);
        });

        // @requirement SC-PRIC-086
        test('a reversal first seen given back in full changes what its invoice owes by nothing', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-seen-won', 20);
            if (!account) return;
            const { payments, subscriberId, brought, invoiceId } = account;

            const seen = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', brought, brought, GIVEN_BACK_AT),
            );

            assert.equal(seen.outcome, 'recorded');
            assert.equal(await payments.owedBy(invoiceId), 0);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 20, open: 20 },
            ]);
        });

        // @requirement SC-PRIC-084
        test('two reports of one reversal at the same moment take it back once', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-race', 20);
            if (!account) return;
            const { payments, brought, invoiceId, gross } = account;

            const outcomes = await Promise.all([
                payments.recordReversal(reversalOf('du_1', 'pi_paid', brought)),
                payments.recordReversal(reversalOf('du_1', 'pi_paid', brought)),
            ]);

            assert.deepEqual(outcomes.map((outcome) => outcome.outcome).sort(), [
                'recorded',
                'unchanged',
            ]);
            assert.equal(await payments.owedBy(invoiceId), gross);
        });

        // @requirement SC-PRIC-084
        test('two reports at once of a reversal already recorded apply what grew once', async (t) => {
            // A first report is written under the reversal's unique key, which
            // makes a second one wait for it. A later report finds the row
            // already there, so nothing but the turn the reversal takes keeps
            // two of them from applying the same growth twice.
            const account = await paidOnce(t, 'tenant-reversal-race-grown', 20);
            if (!account) return;
            const { payments, invoiceId, subscriberId } = account;
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', 10));

            const outcomes = await Promise.all([
                payments.recordReversal(reversalOf('du_1', 'pi_paid', 30)),
                payments.recordReversal(reversalOf('du_1', 'pi_paid', 30)),
            ]);

            assert.deepEqual(outcomes.map((outcome) => outcome.outcome).sort(), [
                'recorded',
                'unchanged',
            ]);
            assert.equal(await payments.owedBy(invoiceId), 10);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 20, open: 0 },
            ]);
        });

        // @requirement SC-PRIC-087
        test('a credit another payment for the same invoice left covers what a reversal would open again, and is owed again when it is given back', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-covered', 20);
            if (!account) return;
            const { payments, attempt, paymentOf, brought, gross, invoiceId, subscriberId } =
                account;
            const own = account.recorded.credit!.id;
            // Later than the payment it covers for, so the two credits read in one order.
            const late = await payments.recordPayment(
                paymentOf(attempt, 'pi_late', 10, { at: new Date(PAID_AT.getTime() + 60_000) }),
            );
            const covering = late!.credit!.id;
            const opened = (Math.round(gross * 100) - 1000) / 100;

            const reversed = await payments.recordReversal(reversalOf('du_1', 'pi_paid', brought));

            assert.ok(reversed.outcome === 'recorded' && reversed.withdrawal);
            assert.deepEqual(reversed.withdrawal.credits, [{ creditId: own, amount: 20 }]);
            assert.deepEqual(reversed.withdrawal.covering, [{ creditId: covering, amount: 10 }]);
            assert.deepEqual(reversed.withdrawal.invoices, [{ invoiceId, amount: opened }]);
            assert.equal(await payments.owedBy(invoiceId), opened);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 20, open: 0 },
                { origin: 'payment', amount: 10, open: 0 },
            ]);

            await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', brought, brought, GIVEN_BACK_AT),
            );

            assert.equal(await payments.owedBy(invoiceId), 0);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 20, open: 20 },
                { origin: 'payment', amount: 10, open: 10 },
            ]);
        });

        /**
         * An invoice paid twice: `pi_paid` settles it and `pi_late`, a minute
         * later, leaves a credit of the whole amount.
         */
        async function paidTwice(t: TestContext, tenantId: string) {
            const account = await paidOnce(t, tenantId);
            if (!account) return null;
            const { payments, attempt, paymentOf, gross } = account;
            const late = await payments.recordPayment(
                paymentOf(attempt, 'pi_late', gross, { at: new Date(PAID_AT.getTime() + 60_000) }),
            );
            assert.ok(late?.credit, 'the second payment left no credit');
            return { ...account, late };
        }

        /** What two reversals of an invoice paid twice leave, whatever their order. */
        async function bothTakenBack(account: NonNullable<Awaited<ReturnType<typeof paidTwice>>>) {
            const { payments, invoiceId, subscriberId, gross } = account;
            assert.equal(await payments.owedBy(invoiceId), gross);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: gross, open: 0 },
            ]);
            assert.deepEqual(
                await payments.listCases({ state: 'open', subscriberId }, { limit: 10 }),
                [],
            );
        }

        // @requirement SC-PRIC-090
        test('a payment whose credit covered another reversal, reversed itself, lifts the cover first', async (t) => {
            const account = await paidTwice(t, 'tenant-reversal-lift');
            if (!account) return;
            const { payments, gross, invoiceId, recorded } = account;
            await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));

            const lifting = await payments.recordReversal(reversalOf('du_b', 'pi_late', gross));

            assert.ok(lifting.outcome === 'recorded' && lifting.withdrawal);
            assert.deepEqual(
                lifting.withdrawal.uncovered.map((each) => [
                    each.paymentId,
                    each.amount,
                    each.invoices,
                    each.unmatched,
                ]),
                [[recorded.payment.id, gross, [{ invoiceId, amount: gross }], 0]],
            );
            assert.deepEqual(
                [
                    lifting.withdrawal.credits.map((part) => part.amount),
                    lifting.withdrawal.unmatched,
                ],
                [[gross], 0],
            );
            await bothTakenBack(account);

            // The earlier reversal given back settles the invoice again, and the
            // credit of the payment reversed since stays taken.
            await payments.recordReversal(
                reversalOf('du_a', 'pi_paid', gross, gross, GIVEN_BACK_AT),
            );
            assert.equal(await payments.owedBy(invoiceId), 0);
            assert.deepEqual(await openCredits(payments, account.subscriberId), [
                { origin: 'payment', amount: gross, open: 0 },
            ]);
        });

        // @requirement SC-PRIC-090
        test('the same two reversals in the other order end alike', async (t) => {
            const account = await paidTwice(t, 'tenant-reversal-lift-other-order');
            if (!account) return;
            const { payments, gross } = account;

            await payments.recordReversal(reversalOf('du_b', 'pi_late', gross));
            await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));

            await bothTakenBack(account);
        });

        /** An invoice paid three times: `pi_third`, a minute after `pi_late`, leaves a credit of the whole amount as well. */
        async function paidThrice(t: TestContext, tenantId: string) {
            const account = await paidTwice(t, tenantId);
            if (!account) return null;
            const { payments, attempt, paymentOf, gross } = account;
            const third = await payments.recordPayment(
                paymentOf(attempt, 'pi_third', gross, {
                    at: new Date(PAID_AT.getTime() + 120_000),
                }),
            );
            assert.ok(third?.credit, 'the third payment left no credit');
            return { ...account, third };
        }

        /** Two of an invoice's three payments reversed: the third payment's credit settles it. */
        async function twoOfThreeTakenBack(
            account: NonNullable<Awaited<ReturnType<typeof paidThrice>>>,
        ) {
            const { payments, invoiceId, subscriberId, gross } = account;
            assert.equal(await payments.owedBy(invoiceId), 0);
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: gross, open: 0 },
                { origin: 'payment', amount: gross, open: 0 },
            ]);
        }

        // @requirement SC-PRIC-090
        test("a cover lifted is taken of another payment's credit for the invoice, as the reversal would have been without the cover", async (t) => {
            const account = await paidThrice(t, 'tenant-reversal-lift-covered-again');
            if (!account) return;
            const { payments, gross, third } = account;
            await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));

            const lifting = await payments.recordReversal(reversalOf('du_b', 'pi_late', gross));

            assert.ok(lifting.outcome === 'recorded' && lifting.withdrawal);
            assert.deepEqual(
                lifting.withdrawal.uncovered.map((each) => [each.covering, each.invoices]),
                [[[{ creditId: third.credit!.id, amount: gross }], []]],
            );
            await twoOfThreeTakenBack(account);
        });

        // @requirement SC-PRIC-090
        test('the same two of three reversals in the other order end alike', async (t) => {
            const account = await paidThrice(t, 'tenant-reversal-lift-covered-again-other-order');
            if (!account) return;
            const { payments, gross } = account;

            await payments.recordReversal(reversalOf('du_b', 'pi_late', gross));
            await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));

            await twoOfThreeTakenBack(account);
        });

        // @requirement SC-PRIC-090
        test('a cover lifted is taken of what the covering credits still hold once the reversal lifting it is written', async (t) => {
            const account = await payable(t, 'tenant-reversal-lift-after-the-withdrawal');
            if (!account) return;
            const { payments, attempts, grosses, paymentOf, ids, subscriberId } = account;
            const [attempt, gross, invoiceId] = [attempts[0]!, grosses[0]!, ids[0]!];
            assert.ok(
                gross > 5,
                'the premise: the invoice is more than the scenario pays beside it',
            );
            const later = (minutes: number) => ({
                at: new Date(PAID_AT.getTime() + minutes * 60_000),
            });
            // pi_part settles 2; pi_rest the rest and leaves 2; pi_third leaves 3.
            await payments.recordPayment(paymentOf(attempt, 'pi_part', 2));
            await payments.recordPayment(paymentOf(attempt, 'pi_rest', gross, later(1)));
            await payments.recordPayment(paymentOf(attempt, 'pi_third', 3, later(2)));
            await payments.recordReversal(reversalOf('du_a', 'pi_part', 2));

            await payments.recordReversal(reversalOf('du_b', 'pi_rest', gross));

            // Taken back: pi_part's 2 and the whole of pi_rest; what pi_third
            // left covers 3 of it, once and no more.
            assert.equal(await payments.owedBy(invoiceId), sumToCents(gross, -3));
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 2, open: 0 },
                { origin: 'payment', amount: 3, open: 0 },
            ]);
        });

        // @requirement SC-PRIC-086
        test('a case a reversal opens as it grows after a give-back is covered only by what is given back after it', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-grows-after-a-give-back', 5);
            if (!account) return;
            const { payments, invoiceId, subscriberId } = account;
            // 3 taken of the credit and given back to it, then the credit paid out.
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', 3));
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', 3, 3, GIVEN_BACK_AT));
            await payments.recordRefund(refundOf('re_1', 'pi_paid', 5));
            // Grown to 8: 2 meet the credit paid out, 3 open the invoice.
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', 8, 3, GIVEN_BACK_AT));
            assert.deepEqual(
                [
                    (await payments.listCases({ state: 'open', subscriberId }, { limit: 10 })).map(
                        (each) => [each.gatewayRef, each.amount],
                    ),
                    await payments.owedBy(invoiceId),
                ],
                [[['du_1', 2]], 3],
                'the premise: a case of 2, opened after the give-back',
            );

            const later = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', 8, 4, GIVEN_BACK_AT),
            );

            assert.ok(later.outcome === 'recorded' && later.reinstatement);
            assert.deepEqual(
                [
                    later.reinstatement.closedCases,
                    later.reinstatement.invoices,
                    later.reversal.reinstatedToCases,
                ],
                [[], [], 1],
            );
            assert.equal(
                (await payments.listCases({ state: 'open', subscriberId }, { limit: 10 })).length,
                1,
            );
            assert.equal(await payments.owedBy(invoiceId), 3);

            // What covered the case is kept: of 2 more, 1 covers the rest of it and
            // 1 settles the invoice again.
            const last = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', 8, 6, GIVEN_BACK_AT),
            );
            assert.ok(last.outcome === 'recorded' && last.reinstatement);
            assert.deepEqual(
                [last.reinstatement.closedCases.length, last.reversal.reinstatedToCases],
                [1, 2],
            );
            assert.equal(await payments.owedBy(invoiceId), 2);
        });

        // @requirement SC-PRIC-087
        test("a part given back returns to the payment's own credit before a covering one", async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-given-in-order', 20);
            if (!account) return;
            const { payments, attempt, paymentOf, brought, subscriberId } = account;
            await payments.recordPayment(
                paymentOf(attempt, 'pi_late', 10, { at: new Date(PAID_AT.getTime() + 60_000) }),
            );
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', brought));

            await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', brought, 15, GIVEN_BACK_AT),
            );

            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: 20, open: 15 },
                { origin: 'payment', amount: 10, open: 0 },
            ]);
        });

        // @requirement SC-PRIC-085
        test('a reversed attempt frees its invoice for another payment method once it is followed up', async (t) => {
            const account = await paidOnce(t, 'tenant-reversal-again');
            if (!account) return;
            const { collections, payments, attempt, gross, invoiceId, subscriberId } = account;
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            if (!methods) return;
            await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_replaced', '2026-03-21T10:00:00.000Z'),
            );
            assert.equal(await collections.markReversed(attempt.id, REVERSED_AT), true);
            assert.equal(await collections.markReversed(attempt.id, REVERSED_AT), false, 'twice');
            assert.equal((await collections.findById(attempt.id))?.status, 'REVERSED');
            assert.ok(
                !(await collections.listCollectableAgain({ limit: 50 })).includes(invoiceId),
                'collected again while nothing is owed',
            );

            await payments.recordReversal(reversalOf('du_1', 'pi_paid', gross));
            assert.ok(
                !(await collections.listCollectableAgain({ limit: 50 })).includes(invoiceId),
                'collected again before the subscriber is told',
            );
            assert.ok((await collections.listToFollowUp({ limit: 50 })).includes(attempt.id));
            assert.equal(await collections.markFollowedUp(attempt.id, REVERSED_AT), true);

            assert.ok((await collections.listCollectableAgain({ limit: 50 })).includes(invoiceId));
            const planned = await collections.plan(planOf(invoiceId, { after: 1 }));
            assert.equal(planned?.attempt, 2);
        });

        // @requirement SC-PRIC-085
        test('an attempt that failed before its payment arrived is marked reversed and followed up again, one on its way is not', async (t) => {
            const account = await payable(t, 'tenant-reversal-not-succeeded');
            if (!account) return;
            const { collections, attempts } = account;
            const [first] = attempts;

            assert.equal(
                await collections.markReversed(first!.id, REVERSED_AT),
                false,
                'on its way',
            );
            await collections.recordOutcome(first!.id, FAILURE, PAID_AT);
            assert.equal(await collections.markFollowedUp(first!.id, PAID_AT), true);

            assert.equal(await collections.markReversed(first!.id, REVERSED_AT), true);
            const reversed = await collections.findById(first!.id);
            assert.deepEqual([reversed?.status, reversed?.followedUpAt], ['REVERSED', null]);
            assert.ok((await collections.listToFollowUp({ limit: 50 })).includes(first!.id));
            assert.equal(await collections.markReversed(first!.id, REVERSED_AT), false, 'twice');
        });

        // @requirement SC-PRIC-085
        test('an invoice is collected again with no payment method one of its payments was reversed on, once every reversal was followed up', async (t) => {
            const account = await payable(t, 'tenant-reversal-late');
            if (!account) return;
            const { collections, payments, attempts, grosses, ids, subscriberId, paymentOf } =
                account;
            const methods = harness.adapter.subscriberPaymentMethodRepository;
            if (!methods) return;
            const invoiceId = ids[0]!;
            const used = await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_used', '2026-01-20T10:00:00.000Z'),
            );
            // The first attempt fails, and so does the second, made with the
            // payment method in use; its payment arrives after all while a
            // third is on its way, which fails as well.
            await collections.recordOutcome(attempts[0]!.id, FAILURE, PAID_AT);
            await collections.markFollowedUp(attempts[0]!.id, PAID_AT);
            const second = await collections.plan({
                ...planOf(invoiceId, { after: 1 }),
                paymentMethodId: used.method.id,
            });
            assert.ok(second && (await collections.submitPlanned(second.id, PAID_AT)));
            await collections.recordOutcome(second.id, FAILURE, PAID_AT);
            await collections.markFollowedUp(second.id, PAID_AT);
            const third = await collections.plan(
                planOf(invoiceId, { after: 2, paymentMethodType: 'sepa_debit' }),
            );
            assert.ok(third && (await collections.submitPlanned(third.id, PAID_AT)));
            const success = {
                status: 'succeeded' as const,
                paymentRef: 'pi_late',
                amountCents: Math.round(grosses[0]! * 100),
                currency: 'EUR',
            };
            assert.equal(await collections.recordOutcome(second.id, success, PAID_AT), false);
            await payments.recordPayment(paymentOf(second, 'pi_late', grosses[0]!));
            await collections.recordOutcome(third.id, FAILURE, PAID_AT);
            await collections.markFollowedUp(third.id, PAID_AT);

            await payments.recordReversal(reversalOf('du_1', 'pi_late', grosses[0]!));
            assert.equal(await collections.markReversed(second.id, REVERSED_AT), true);

            const collectable = async () =>
                (await collections.listCollectableAgain({ limit: 50 })).includes(invoiceId);
            assert.equal(
                await collectable(),
                false,
                'collected again before the subscriber is told',
            );
            assert.equal(await collections.markFollowedUp(second.id, REVERSED_AT), true);
            assert.equal(
                await collectable(),
                false,
                'collected again with the payment method a payment was reversed on',
            );
            await methods.recordConfirmed(
                paymentMethodFor(subscriberId, 'pm_new', '2026-03-21T10:00:00.000Z'),
            );
            assert.equal(await collectable(), true);
        });

        // @requirement SC-ADM-033
        test('cases are listed open or closed, the oldest first, page by page, and closed once with a note', async (t) => {
            const account = await paidOnce(t, 'tenant-cases');
            if (!account) return;
            const { payments, subscriberId } = account;
            for (const [index, ref] of ['re_1', 're_2', 're_3'].entries()) {
                await payments.recordRefund(
                    refundOf(
                        ref,
                        'pi_paid',
                        1 + index,
                        'PENDING',
                        new Date(Date.UTC(2026, 1, 10 + index)),
                    ),
                );
            }
            const page = (state: 'open' | 'closed', after?: string) =>
                payments.listCases({ state, subscriberId }, { limit: 2, after });

            const first = await page('open');
            assert.deepEqual(
                first.map((each) => each.amount),
                [1, 2],
            );
            assert.deepEqual(
                (await page('open', first[1]!.id)).map((each) => each.amount),
                [3],
            );
            assert.deepEqual(
                await payments.listCases({ state: 'open', subscriberId: 'nobody' }, { limit: 2 }),
                [],
            );

            const closing = {
                caseId: first[0]!.id,
                note: 'Recovered by transfer TRF-9.',
                closedBy: 'operator-1',
                at: GIVEN_BACK_AT,
            };
            const closed = await payments.closeCase(closing);
            assert.ok(closed.outcome === 'closed');
            assert.deepEqual(
                [closed.case.closedBy, closed.case.note, closed.case.closedAt?.getTime()],
                ['operator-1', 'Recovered by transfer TRF-9.', GIVEN_BACK_AT.getTime()],
            );
            const again = await payments.closeCase({ ...closing, note: 'Another note.' });
            assert.ok(again.outcome === 'already-closed');
            assert.equal(again.case.note, 'Recovered by transfer TRF-9.');
            assert.deepEqual(await payments.closeCase({ ...closing, caseId: NO_SUCH_VERSION }), {
                outcome: 'unknown-case',
            });
            assert.deepEqual(
                (await page('closed')).map((each) => each.id),
                [first[0]!.id],
            );
            assert.deepEqual(
                (await page('open')).map((each) => each.amount),
                [2, 3],
            );
        });

        // @requirement SC-ADM-033
        test("a refund's unmatched part opens one case, and its failure closes it", async (t) => {
            const account = await paidOnce(t, 'tenant-case-refund');
            if (!account) return;
            const { payments, subscriberId } = account;

            const recorded = await payments.recordRefund(refundOf('re_1', 'pi_paid', 30));
            assert.ok(recorded.outcome === 'recorded' && recorded.case);
            assert.deepEqual(
                [recorded.case.kind, recorded.case.refundId, recorded.case.amount],
                ['REFUND_UNMATCHED', recorded.refund.id, 30],
            );
            await payments.recordRefund(refundOf('re_1', 'pi_paid', 30, 'SUCCEEDED'));
            assert.equal(
                (await payments.listCases({ state: 'open', subscriberId }, { limit: 10 })).length,
                1,
                'opened twice',
            );

            const failed = await payments.recordRefund(refundOf('re_1', 'pi_paid', 30, 'FAILED'));
            assert.ok(failed.outcome === 'given-back');
            assert.deepEqual(
                failed.closedCases.map((each) => [each.id, each.closedBy]),
                [[recorded.case.id, null]],
            );
            assert.deepEqual(
                await payments.listCases({ state: 'open', subscriberId }, { limit: 10 }),
                [],
            );
        });

        // @requirement SC-PRIC-030
        test('the accounts a credit not paid out is held at', async (t) => {
            const account = await paidOnce(t, 'tenant-credits-held', 20);
            if (!account) return;
            const { payments, recorded } = account;
            assert.deepEqual(await payments.accountsHoldingCredits(), ['stripe-main']);

            await payments.recordPayout({
                creditId: recorded.credit!.id,
                amount: 20,
                reference: 'TRF-1',
                paidOn: '2026-02-20',
                note: null,
                recordedBy: 'operator-1',
                at: PAID_AT,
            });
            assert.deepEqual(await payments.accountsHoldingCredits(), []);

            await payments.recordReversal(reversalOf('du_1', 'pi_paid', 5));
            assert.deepEqual(
                await payments.accountsHoldingCredits(),
                [],
                'a reversal paid nothing out',
            );
        });

        // @requirement SC-ADM-033
        test('what several invoices owe, in one read', async (t) => {
            const account = await payable(t, 'tenant-owed-several', 2);
            if (!account) return;
            const { payments, attempts, grosses, paymentOf, ids } = account;
            await payments.recordPayment(
                paymentOf(attempts[0]!, 'pi_1', sumToCents(grosses[0]!, -0.01)),
            );

            const owed = await payments.owedByInvoices([...ids, NO_SUCH_VERSION]);
            assert.deepEqual(
                owed.sort((a, b) => ids.indexOf(a.invoiceId) - ids.indexOf(b.invoiceId)),
                [
                    { invoiceId: ids[0], owed: 0.01 },
                    { invoiceId: ids[1], owed: grosses[1] },
                ],
            );
            assert.deepEqual(await payments.owedByInvoices([]), []);
        });

        // @requirement SC-PRIC-036
        test('an attempt is planned for what the invoice owes when it is planned, a payment arrived since counted', async (t) => {
            const account = await payable(t, 'tenant-plan-what-is-owed');
            if (!account) return;
            const { collections, payments, attempts, grosses, paymentOf, ids } = account;
            await collections.recordOutcome(attempts[0]!.id, FAILURE, STARTED_AT);
            // A late payment of part of it, for the attempt that failed.
            await payments.recordPayment(paymentOf(attempts[0]!, 'pi_late', 10));

            const planned = await collections.plan(planOf(ids[0]!, { after: 1 }));

            assert.equal(planned?.amount, sumToCents(grosses[0]!, -10));
        });

        // -------------------------------------------------------------
        // Cancellations — an invoice corrected by a cancellation invoice
        // and its replacement, in the turn of its chain
        // -------------------------------------------------------------

        /** When the scenarios below cancel an invoice, and what they give as the reason. */
        const CANCELLED_AT = new Date('2026-03-02T09:00:00.000Z');
        const CANCELLATION_REASON = 'The billing address was wrong.';
        const CORRECTION_ISSUE = {
            issuedAt: CANCELLED_AT,
            timeZone: 'Europe/Berlin',
            numberPrefix: 'EX',
        };

        /** The treatment a replacement is issued under where its subscriber turned out to owe the tax. */
        const REVERSE_CHARGE: TaxTreatment = {
            kind: 'reverse-charge',
            rate: 0,
            note: 'Steuerschuldnerschaft des Leistungsempfängers',
            adapter: { name: '@saasicat/tax-de', version: '1.0.0-rc.25' },
        };

        /**
         * Cancels `invoiceId` as the platform does (`SC-PRIC-095`): in the turn of
         * its chain, the cancellation invoice and — unless `replace` is false — a
         * replacement under `treatment`, then what was paid for the invoice moved
         * onto the replacement, or into credits. `owed` names the lines not owed,
         * or not in full: their counter-entries are written on the same turn and
         * stand on the replacement, where any is still owed (`SC-PRIC-020`).
         * `pause` holds the turn after the shares are read; `fail` throws once
         * everything is written, so that the transaction rolls back.
         */
        async function cancelInvoice(
            invoiceId: string,
            {
                replace = true,
                owed,
                treatment = INVOICE_TREATMENT,
                pause = 0,
                fail = false,
            }: {
                replace?: boolean;
                owed?: { position: number; owed: number }[];
                treatment?: TaxTreatment;
                pause?: number;
                fail?: boolean;
            } = {},
        ) {
            const invoices = harness.adapter.subscriptionInvoiceRepository!;
            const payments = harness.adapter.subscriberPaymentRepository!;
            const ledger = harness.adapter.subscriberLedgerRepository!;
            return harness.adapter.transactionRunner.run(async (tx) => {
                const chain = await invoices.holdChain(invoiceId, tx);
                const cancelled = chain?.invoices.find((each) => each.id === invoiceId);
                assert.ok(cancelled, `invoice ${invoiceId} was not found in its chain`);
                const shares = await payments.sharesOf(invoiceId, tx);
                if (pause > 0) await sleep(pause);
                const issue = {
                    ...CORRECTION_ISSUE,
                    subscriber: cancelled.subscriber,
                    issuer: cancelled.issuer,
                    footer: cancelled.footer,
                    treatment,
                    tax: taxPerRate,
                    paymentTermDays: 14,
                    directDebitLeadDays: 5,
                    payment: cancelled.payment,
                    paid: paidByShares(shares),
                };
                const corrections = owed
                    ? lineCorrectionsOf(cancelled, owed, {
                          journal: await ledger.listBySubscription(cancelled.subscriptionId, tx),
                          reduces: () => ({ source: 'plan' }),
                          reason: CANCELLATION_REASON,
                          bookedAt: CANCELLED_AT,
                      })
                    : null;
                const counterEntries =
                    corrections && corrections.counterEntries.length > 0
                        ? await ledger.recordCharges(corrections.counterEntries, tx)
                        : [];
                const planned =
                    corrections && draftCorrectedReplacementInvoice(cancelled, issue, corrections);
                const replacement = !replace
                    ? null
                    : corrections
                      ? planned &&
                        writtenReplacementOf(
                            planned,
                            corrections.counterEntries.map(
                                (entry) =>
                                    counterEntries.find(
                                        (each) => each.sourceRef === entry.sourceRef,
                                    )!.id,
                            ),
                        )
                      : draftReplacementInvoice(cancelled, issue);
                const issued = await invoices.issueCancellation(
                    {
                        cancelledInvoiceId: invoiceId,
                        cancellation: draftCancellationInvoice(cancelled, CORRECTION_ISSUE),
                        replacement,
                        reason: CANCELLATION_REASON,
                        correctedSubscriber: null,
                        deliverTo: null,
                        cancelledBy: 'operator-1',
                        cancelledAt: CANCELLED_AT,
                    },
                    tx,
                );
                const credits = await payments.moveShares(
                    {
                        cancellationId: issued.cancellation.id,
                        cancelledInvoiceId: invoiceId,
                        replacementInvoiceId: issued.replacement?.id ?? null,
                        parts: movedPaymentParts(shares, issued.replacement?.totalGross ?? 0),
                        at: CANCELLED_AT,
                    },
                    tx,
                );
                if (fail) throw new Error('the run that cancelled it failed');
                return { ...issued, credits };
            });
        }

        /** What each payment still settles of `invoiceId`, the payments by their gateway reference. */
        async function sharesByRef(invoiceId: string) {
            const payments = harness.adapter.subscriberPaymentRepository!;
            const shares = await harness.adapter.transactionRunner.run((tx) =>
                payments.sharesOf(invoiceId, tx),
            );
            const refs = new Map<string, string>();
            for (const share of shares) {
                const payment = await payments.findPaymentById(share.paymentId);
                refs.set(share.paymentId, payment?.gatewayRef ?? share.paymentId);
            }
            return shares
                .map((share) => [refs.get(share.paymentId), share.amount])
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en'));
        }

        /** Hands invoice `invoiceId`'s document to the mail, as the run does before collecting it. */
        async function deliver(invoiceId: string) {
            const invoices = harness.adapter.subscriptionInvoiceRepository!;
            await invoices.recordRendering(invoiceId, renderingOf(CHECKSUM));
            await invoices.markArchived(invoiceId, STARTED_AT, CHECKSUM);
            await invoices.claimDelivery(invoiceId, STARTED_AT, STARTED_AT);
            await invoices.markDelivered(invoiceId, {
                claimedAt: STARTED_AT,
                at: STARTED_AT,
                to: 'billing@example.com',
            });
        }

        /** `amount` taken the other way, nothing staying nothing. */
        const reversedAmount = (amount: number) => (amount === 0 ? 0 : -amount);

        /** The journal's corrections of `subscriptionId`, as charge, invoice and amount. */
        async function correctionsOf(subscriptionId: string) {
            const ledger = harness.adapter.subscriberLedgerRepository!;
            return (await ledger.listBySubscription(subscriptionId))
                .filter((entry) => entry.origin === 'correction')
                .map((entry) => [
                    entry.correction?.chargeId,
                    entry.correction?.invoiceId,
                    entry.amountNet,
                ]);
        }

        test('a charge owed in part is lowered by a counter-entry on the same turn, which the replacement carries after the line it corrects', async (t) => {
            const account = await payable(t, 'tenant-cancel-owed-in-part');
            if (!account) return;
            const { invoices, ids } = account;
            const invoiceId = ids[0]!;
            const original = await invoices.findById(invoiceId);
            assert.ok(original);
            const line = original.lines[0]!;

            const { replacement } = await cancelInvoice(invoiceId, {
                owed: [{ position: 1, owed: 9.95 }],
            });

            assert.ok(replacement, 'no replacement was written');
            const read = await invoices.findById(replacement.id);
            assert.deepEqual(
                read?.lines.map((each) => [
                    each.position,
                    each.origin,
                    each.amountNet,
                    each.correctedPosition,
                    each.correctsPosition,
                ]),
                [
                    [1, line.origin, line.amountNet, 1, null],
                    [2, 'correction', -sumToCents(line.amountNet, -9.95), null, 1],
                ],
            );
            assert.equal(read?.totalNet, 9.95);
            assert.deepEqual(await correctionsOf(original.subscriptionId), [
                [line.chargeId, invoiceId, -sumToCents(line.amountNet, -9.95)],
            ]);
        });

        test('a charge owed no more leaves no replacement, its counter-entry on no invoice, and the run does not take it', async (t) => {
            const account = await payable(t, 'tenant-cancel-owed-no-more');
            if (!account) return;
            const { invoices, ids } = account;
            const invoiceId = ids[0]!;
            const original = await invoices.findById(invoiceId);
            assert.ok(original);

            const { replacement, cancellation } = await cancelInvoice(invoiceId, {
                owed: [{ position: 1, owed: 0 }],
            });

            assert.equal(replacement, null);
            assert.equal(cancellation.replacementInvoiceId, null);
            assert.deepEqual(await correctionsOf(original.subscriptionId), [
                [original.lines[0]!.chargeId, invoiceId, -original.lines[0]!.amountNet],
            ]);
            assert.deepEqual(await invoices.listUninvoicedCharges(original.subscriptionId), []);
        });

        test('a cancellation whose turn fails writes no counter-entry', async (t) => {
            const account = await payable(t, 'tenant-cancel-owed-fails');
            if (!account) return;
            const { invoices, ids } = account;
            const invoiceId = ids[0]!;
            const original = await invoices.findById(invoiceId);
            assert.ok(original);

            await assert.rejects(
                cancelInvoice(invoiceId, { owed: [{ position: 1, owed: 9.95 }], fail: true }),
                /the run that cancelled it failed/,
            );

            assert.deepEqual(await correctionsOf(original.subscriptionId), []);
            const chain = await harness.adapter.transactionRunner.run((tx) =>
                invoices.holdChain(invoiceId, tx),
            );
            assert.deepEqual(
                [chain?.invoices.map((each) => each.id), chain?.cancellations],
                [[invoiceId], []],
            );
        });

        test("a replacement whose correction's line names no line of it, or a position it lacks, is refused, and nothing is written", async (t) => {
            const account = await payable(t, 'tenant-cancel-owed-misnamed');
            if (!account) return;
            const { invoices, ids } = account;
            const ledger = harness.adapter.subscriberLedgerRepository!;
            const invoiceId = ids[0]!;
            const original = await invoices.findById(invoiceId);
            assert.ok(original);

            for (const [what, corrects] of [
                ['names none', null],
                ['names a position it lacks', 9],
            ] as const) {
                await assert.rejects(
                    harness.adapter.transactionRunner.run(async (tx) => {
                        const chain = await invoices.holdChain(invoiceId, tx);
                        const cancelled = chain?.invoices.find((each) => each.id === invoiceId);
                        assert.ok(cancelled);
                        const charge = (
                            await ledger.listBySubscription(cancelled.subscriptionId, tx)
                        ).find((entry) => entry.id === cancelled.lines[0]!.chargeId);
                        assert.ok(charge);
                        const [counterEntry] = await ledger.recordCharges(
                            [
                                counterEntryOf(charge, {
                                    invoiceId,
                                    by: 1,
                                    reason: CANCELLATION_REASON,
                                    bookedAt: CANCELLED_AT,
                                }),
                            ],
                            tx,
                        );
                        const replacement = draftReplacementInvoice(cancelled, {
                            ...CORRECTION_ISSUE,
                            subscriber: cancelled.subscriber,
                            issuer: cancelled.issuer,
                            footer: cancelled.footer,
                            treatment: INVOICE_TREATMENT,
                            tax: taxPerRate,
                            paymentTermDays: 14,
                            directDebitLeadDays: 5,
                            payment: cancelled.payment,
                            paid: 0,
                        });
                        replacement.lines.push({
                            ...replacement.lines[0]!,
                            position: 2,
                            chargeId: counterEntry!.id,
                            origin: 'correction',
                            amountNet: -1,
                            correctedPosition: null,
                            correctsPosition: corrects,
                        });
                        await invoices.issueCancellation(
                            {
                                cancelledInvoiceId: invoiceId,
                                cancellation: draftCancellationInvoice(cancelled, CORRECTION_ISSUE),
                                replacement,
                                reason: CANCELLATION_REASON,
                                correctedSubscriber: null,
                                deliverTo: null,
                                cancelledBy: 'operator-1',
                                cancelledAt: CANCELLED_AT,
                            },
                            tx,
                        );
                    }),
                    `a correction's line that ${what} was written`,
                );
            }

            assert.deepEqual(await correctionsOf(original.subscriptionId), []);
            const chain = await harness.adapter.transactionRunner.run((tx) =>
                invoices.holdChain(invoiceId, tx),
            );
            assert.deepEqual(chain?.cancellations, []);
        });

        // @requirement SC-PRIC-095
        test('an invoice is cancelled by a cancellation invoice and a replacement that follow it in its chain, each naming it', async (t) => {
            const account = await payable(t, 'tenant-cancel-once');
            if (!account) return;
            const { invoices, payments, ids, grosses, subscriberId } = account;
            const invoiceId = ids[0]!;
            const gross = grosses[0]!;
            const original = await invoices.findById(invoiceId);
            assert.ok(original);

            const { cancellation, cancellationInvoice, replacement, credits } =
                await cancelInvoice(invoiceId);

            assert.ok(replacement, 'no replacement was written');
            assert.deepEqual(credits, [], 'nothing was paid, so nothing is credited');
            assert.deepEqual(
                [cancellationInvoice, replacement].map((each) => [
                    each.number,
                    each.chainId,
                    each.chainStep,
                ]),
                [
                    ['EX-2026-000002', invoiceId, 1],
                    ['EX-2026-000003', invoiceId, 2],
                ],
            );
            const named = {
                invoiceId,
                number: original.number,
                issueDate: original.issueDate,
            };
            assert.deepEqual(cancellationInvoice.correction, {
                kind: 'cancellation',
                of: named,
                reason: CANCELLATION_REASON,
            });
            assert.deepEqual(replacement.correction, {
                kind: 'replacement',
                of: named,
                reason: CANCELLATION_REASON,
            });
            assert.deepEqual(
                cancellationInvoice.lines.map((line) => [
                    line.chargeId,
                    line.correctedPosition,
                    line.amountNet,
                ]),
                original.lines.map((line) => [
                    line.chargeId,
                    line.position,
                    reversedAmount(line.amountNet),
                ]),
            );
            assert.deepEqual(
                replacement.lines.map((line) => [line.chargeId, line.correctedPosition]),
                original.lines.map((line) => [line.chargeId, line.position]),
            );
            assert.deepEqual(
                [
                    cancellationInvoice.totalGross,
                    cancellationInvoice.payment,
                    replacement.totalGross,
                ],
                [reversedAmount(gross), null, gross],
            );
            assert.deepEqual(cancellation, {
                id: cancellation.id,
                cancelledInvoiceId: invoiceId,
                cancellationInvoiceId: cancellationInvoice.id,
                replacementInvoiceId: replacement.id,
                reason: CANCELLATION_REASON,
                correctedSubscriber: null,
                deliverTo: null,
                cancelledBy: 'operator-1',
                cancelledAt: CANCELLED_AT,
            });

            // Read back as written, from wherever in the chain it is asked.
            assert.deepEqual(await invoices.findById(cancellationInvoice.id), cancellationInvoice);
            assert.deepEqual(await invoices.findById(replacement.id), replacement);
            assert.equal((await invoices.findById(invoiceId))?.correction, null);
            for (const id of [invoiceId, cancellationInvoice.id, replacement.id]) {
                assert.deepEqual(await invoices.findCancellation(id), cancellation);
            }
            assert.equal(await invoices.findCancellation(NO_SUCH_VERSION), null);
            assert.deepEqual(await invoices.findCancellationById(cancellation.id), cancellation);
            assert.equal(await invoices.findCancellationById(NO_SUCH_VERSION), null);
            assert.deepEqual(
                (await invoices.listBySubscriber(subscriberId)).map((each) => each.id),
                [replacement.id, cancellationInvoice.id, invoiceId],
            );
            const chain = await harness.adapter.transactionRunner.run((tx) =>
                invoices.holdChain(replacement.id, tx),
            );
            assert.deepEqual(
                chain?.invoices.map((each) => [each.id, each.chainStep]),
                [
                    [invoiceId, 0],
                    [cancellationInvoice.id, 1],
                    [replacement.id, 2],
                ],
            );
            assert.deepEqual(chain?.cancellations, [cancellation]);
            assert.equal(
                await harness.adapter.transactionRunner.run((tx) =>
                    invoices.holdChain(NO_SUCH_VERSION, tx),
                ),
                null,
            );

            // What is owed stands on the replacement alone; the cancellation
            // invoice and the invoice it cancels add up to nothing.
            const owed = await payments.owedByInvoices([
                invoiceId,
                cancellationInvoice.id,
                replacement.id,
            ]);
            assert.deepEqual(Object.fromEntries(owed.map((each) => [each.invoiceId, each.owed])), {
                [invoiceId]: 0,
                [cancellationInvoice.id]: 0,
                [replacement.id]: gross,
            });
            assert.equal(await payments.owedBy(cancellationInvoice.id), 0);
            assert.ok(
                !(await payments.listUncredited({ limit: 100 })).includes(cancellationInvoice.id),
                'a cancellation invoice was listed as a credit owed',
            );
            assert.equal(await payments.creditInvoice(cancellationInvoice.id, CANCELLED_AT), null);
            assert.deepEqual(await openCredits(payments, subscriberId), []);
        });

        // @requirement SC-PRIC-036
        test('an invoice is cancelled once: a second cancellation is refused and draws no number, and its replacement is cancelled instead', async (t) => {
            const account = await payable(t, 'tenant-cancel-twice');
            if (!account) return;
            const { invoices, payments, ids, grosses } = account;
            const invoiceId = ids[0]!;
            const original = await invoices.findById(invoiceId);
            const first = await cancelInvoice(invoiceId);
            assert.ok(first.replacement);

            await assert.rejects(
                cancelInvoice(invoiceId),
                refusedAs(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ALREADY_CANCELLED, {
                    number: original?.number,
                }),
            );
            const second = await cancelInvoice(first.replacement.id);

            assert.ok(second.replacement);
            assert.deepEqual(
                [second.cancellationInvoice, second.replacement].map((each) => [
                    each.number,
                    each.chainId,
                    each.chainStep,
                ]),
                [
                    ['EX-2026-000004', invoiceId, 3],
                    ['EX-2026-000005', invoiceId, 4],
                ],
                'the refused cancellation drew a number, or the chain did not run on',
            );
            assert.equal(second.replacement.correction?.of.invoiceId, first.replacement.id);
            // The first replacement takes part in both: its own cancellation is answered.
            assert.deepEqual(
                await invoices.findCancellation(first.replacement.id),
                second.cancellation,
            );
            assert.deepEqual(await invoices.findCancellation(invoiceId), first.cancellation);
            assert.deepEqual(
                [
                    await payments.owedBy(first.replacement.id),
                    await payments.owedBy(second.replacement.id),
                ],
                [0, grosses[0]],
            );
            const chain = await harness.adapter.transactionRunner.run((tx) =>
                invoices.holdChain(invoiceId, tx),
            );
            assert.deepEqual(
                [
                    chain?.invoices.length,
                    chain?.cancellations.map((each) => each.cancelledInvoiceId),
                ],
                [5, [invoiceId, first.replacement.id]],
            );
        });

        // @requirement SC-PRIC-095
        test('what was paid for a cancelled invoice moves onto the replacement, the oldest payment first, and what it does not take is a credit of the payment and the cancellation', async (t) => {
            const account = await payable(t, 'tenant-cancel-paid');
            if (!account) return;
            const { invoices, payments, attempts, grosses, paymentOf, ids, subscriberId } = account;
            const invoiceId = ids[0]!;
            const gross = grosses[0]!;
            const net = (await invoices.findById(invoiceId))!.totalNet;
            await payments.recordPayment(paymentOf(attempts[0]!, 'pi_early', 10));
            const late = await payments.recordPayment(
                paymentOf(attempts[0]!, 'pi_late', sumToCents(gross, -10), {
                    at: new Date(PAID_AT.getTime() + 60_000),
                }),
            );
            assert.equal(await payments.owedBy(invoiceId), 0);

            // The subscriber owes the tax itself: the replacement asks for the net.
            const { cancellation, replacement, credits } = await cancelInvoice(invoiceId, {
                treatment: REVERSE_CHARGE,
            });

            assert.ok(replacement);
            assert.deepEqual(
                [replacement.totalGross, replacement.paidOnIssue, replacement.payment],
                [net, net, null],
                'the replacement did not state what was paid, or was collected all the same',
            );
            assert.deepEqual(await sharesByRef(replacement.id), [
                ['pi_early', 10],
                ['pi_late', sumToCents(net, -10)],
            ]);
            assert.deepEqual(await sharesByRef(invoiceId), []);
            assert.deepEqual(
                [await payments.owedBy(invoiceId), await payments.owedBy(replacement.id)],
                [0, 0],
            );
            const rest = sumToCents(gross, -net);
            assert.deepEqual(
                credits.map((each) => [each.origin, each.amount]),
                [
                    [
                        {
                            kind: 'cancellation',
                            cancellationId: cancellation.id,
                            paymentId: late!.payment.id,
                        },
                        rest,
                    ],
                ],
            );
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'cancellation', amount: rest, open: rest },
            ]);
        });

        // @requirement SC-PRIC-095
        // @requirement SC-PRIC-036
        test('a payment confirmed after the cancellation settles the replacement, and is a credit where the cancellation left none', async (t) => {
            const account = await payable(t, 'tenant-cancel-then-paid', 2);
            if (!account) return;
            const { payments, attempts, grosses, paymentOf, ids, subscriberId } = account;
            const replaced = await cancelInvoice(ids[0]!);
            await cancelInvoice(ids[1]!, { replace: false });

            const settling = await payments.recordPayment(
                paymentOf(attempts[0]!, 'pi_after', grosses[0]!),
            );
            const crediting = await payments.recordPayment(
                paymentOf(attempts[1]!, 'pi_none', grosses[1]!),
            );

            assert.deepEqual([settling?.settled, settling?.credit], [grosses[0], null]);
            assert.deepEqual(
                [await payments.owedBy(ids[0]!), await payments.owedBy(replaced.replacement!.id)],
                [0, 0],
            );
            assert.deepEqual(await sharesByRef(replaced.replacement!.id), [
                ['pi_after', grosses[0]],
            ]);
            assert.deepEqual(
                [crediting?.settled, crediting?.credit?.amount, crediting?.credit?.origin.kind],
                [0, grosses[1], 'payment'],
            );
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: grosses[1], open: grosses[1] },
            ]);
        });

        // @requirement SC-PRIC-095
        // @requirement SC-PRIC-084
        test('a reversal of a payment whose share moved takes the credit the cancellation left first, then opens the replacement', async (t) => {
            const account = await paidOnce(t, 'tenant-cancel-reversed');
            if (!account) return;
            const { invoices, payments, gross, invoiceId, subscriberId } = account;
            const net = (await invoices.findById(invoiceId))!.totalNet;
            const { replacement, credits } = await cancelInvoice(invoiceId, {
                treatment: REVERSE_CHARGE,
            });
            assert.ok(replacement);
            const [left] = credits;
            assert.ok(left, 'the share the replacement did not take is no credit');

            const reversed = await payments.recordReversal(reversalOf('du_1', 'pi_paid', gross));

            assert.ok(reversed.outcome === 'recorded' && reversed.withdrawal);
            assert.deepEqual(reversed.withdrawal.credits, [
                { creditId: left.id, amount: sumToCents(gross, -net) },
            ]);
            assert.deepEqual(reversed.withdrawal.invoices, [
                { invoiceId: replacement.id, amount: net },
            ]);
            assert.equal(reversed.withdrawal.unmatched, 0);
            assert.deepEqual(
                [await payments.owedBy(invoiceId), await payments.owedBy(replacement.id)],
                [0, net],
            );
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'cancellation', amount: sumToCents(gross, -net), open: 0 },
            ]);
        });

        // @requirement SC-PRIC-095
        // @requirement SC-PRIC-086
        test('a reversal given back after its invoice was cancelled settles the replacement, part by part, and leaves no credit', async (t) => {
            const account = await paidOnce(t, 'tenant-cancel-given-back');
            if (!account) return;
            const { payments, gross, invoiceId, subscriberId } = account;
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', gross));
            const { replacement } = await cancelInvoice(invoiceId);
            assert.ok(replacement);
            assert.equal(await payments.owedBy(replacement.id), gross, 'nothing moved');

            const part = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', gross, 10, GIVEN_BACK_AT),
            );
            const rest = await payments.recordReversal(
                reversalOf('du_1', 'pi_paid', gross, gross, GIVEN_BACK_AT),
            );

            assert.ok(part.outcome === 'recorded' && part.reinstatement);
            assert.deepEqual(part.reinstatement.invoices, [
                { invoiceId: replacement.id, amount: 10 },
            ]);
            assert.ok(rest.outcome === 'recorded' && rest.reinstatement);
            assert.deepEqual(rest.reinstatement.invoices, [
                { invoiceId: replacement.id, amount: sumToCents(gross, -10) },
            ]);
            assert.equal(rest.reinstatement.credit, null);
            assert.deepEqual(
                [await payments.owedBy(invoiceId), await payments.owedBy(replacement.id)],
                [0, 0],
            );
            assert.deepEqual(await openCredits(payments, subscriberId), []);
        });

        /**
         * An invoice paid twice whose first payment was reversed while the
         * second one's credit covered it, then cancelled with a replacement
         * under reverse charge, which takes only the net of the first payment's
         * share and leaves the rest of it as a credit.
         */
        async function coveredThenCancelled(t: TestContext, tenantId: string) {
            const account = await paidTwice(t, tenantId);
            if (!account) return null;
            const { invoices, payments, gross, invoiceId } = account;
            const net = (await invoices.findById(invoiceId))!.totalNet;
            const covered = await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));
            assert.ok(
                covered.outcome === 'recorded' && covered.withdrawal?.invoices.length === 0,
                "the premise: the second payment's credit covers the first reversal",
            );
            const { replacement, credits } = await cancelInvoice(invoiceId, {
                treatment: REVERSE_CHARGE,
            });
            const [left] = credits;
            assert.ok(replacement && left, 'the premise: a replacement, and a credit beside it');
            return { ...account, net, replacement, left };
        }

        /** Both payments of a cancelled invoice reversed: the replacement owes its own total, and no credit is open. */
        async function bothTakenBackAfterTheCancellation(
            account: NonNullable<Awaited<ReturnType<typeof coveredThenCancelled>>>,
        ) {
            const { payments, invoiceId, replacement, net, gross, subscriberId } = account;
            assert.deepEqual(
                [await payments.owedBy(invoiceId), await payments.owedBy(replacement.id)],
                [0, net],
            );
            assert.deepEqual(await openCredits(payments, subscriberId), [
                { origin: 'payment', amount: gross, open: 0 },
                { origin: 'cancellation', amount: sumToCents(gross, -net), open: 0 },
            ]);
            assert.deepEqual(
                await payments.listCases({ state: 'open', subscriberId }, { limit: 10 }),
                [],
            );
            // The first reversal took the credit the cancellation left, as its
            // own: reported again, it is that reversal and nothing grows.
            const again = await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));
            assert.deepEqual(
                [again.outcome, again.outcome === 'unchanged' && again.reversal.fromCredit],
                ['unchanged', sumToCents(gross, -net)],
            );
        }

        // @requirement SC-PRIC-095
        // @requirement SC-PRIC-090
        test("a cover lifted after its invoice was cancelled takes the credit the cancellation left first, and opens the replacement by no more than its payment's share", async (t) => {
            const account = await coveredThenCancelled(t, 'tenant-cancel-lift');
            if (!account) return;
            const { payments, gross, net, replacement, left, recorded } = account;

            const lifting = await payments.recordReversal(reversalOf('du_b', 'pi_late', gross));

            assert.ok(lifting.outcome === 'recorded' && lifting.withdrawal);
            assert.deepEqual(
                lifting.withdrawal.uncovered.map((each) => [
                    each.paymentId,
                    each.amount,
                    each.credits,
                    each.invoices,
                    each.unmatched,
                ]),
                [
                    [
                        recorded.payment.id,
                        gross,
                        [{ creditId: left.id, amount: sumToCents(gross, -net) }],
                        [{ invoiceId: replacement.id, amount: net }],
                        0,
                    ],
                ],
            );
            await bothTakenBackAfterTheCancellation(account);
        });

        // @requirement SC-PRIC-090
        test('the same two reversals around a cancellation in the other order end alike', async (t) => {
            const account = await paidTwice(t, 'tenant-cancel-lift-other-order');
            if (!account) return;
            const { invoices, payments, gross, invoiceId } = account;
            const net = (await invoices.findById(invoiceId))!.totalNet;
            await payments.recordReversal(reversalOf('du_b', 'pi_late', gross));
            const { replacement, credits } = await cancelInvoice(invoiceId, {
                treatment: REVERSE_CHARGE,
            });
            const [left] = credits;
            assert.ok(replacement && left);

            await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));

            await bothTakenBackAfterTheCancellation({ ...account, net, replacement, left });
        });

        // @requirement SC-PRIC-090
        test('a cover lifted that reaches a credit the cancellation left and the operator paid out is a case, and opens nothing', async (t) => {
            const account = await paidTwice(t, 'tenant-cancel-lift-paid-out');
            if (!account) return;
            const { payments, gross, invoiceId, subscriberId } = account;
            await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));
            const { credits } = await cancelInvoice(invoiceId, { replace: false });
            assert.deepEqual(
                credits.map((each) => each.amount),
                [gross],
                "the premise: the first payment's share is a credit",
            );
            await payments.recordRefund(refundOf('re_1', 'pi_paid', gross));

            const lifting = await payments.recordReversal(reversalOf('du_b', 'pi_late', gross));

            assert.ok(lifting.outcome === 'recorded' && lifting.withdrawal);
            const [lifted] = lifting.withdrawal.uncovered;
            assert.deepEqual(
                [lifted?.credits, lifted?.invoices, lifted?.unmatched, lifted?.case?.gatewayRef],
                [[], [], gross, 'du_a'],
            );
            assert.deepEqual(
                (await payments.listCases({ state: 'open', subscriberId }, { limit: 10 })).map(
                    (each) => [each.kind, each.gatewayRef, each.amount],
                ),
                [['REVERSAL_UNMATCHED', 'du_a', gross]],
            );
            assert.equal(await payments.owedBy(invoiceId), 0);
        });

        // @requirement SC-PRIC-086
        // @requirement SC-PRIC-090
        test('a case a lifted cover opens after an earlier give-back is covered only by what is given back after it', async (t) => {
            const account = await paidTwice(t, 'tenant-cancel-lift-after-a-give-back');
            if (!account) return;
            const { invoices, payments, gross, invoiceId, subscriberId } = account;
            const net = (await invoices.findById(invoiceId))!.totalNet;
            const unmatched = sumToCents(gross, -net);
            assert.ok(net > 5 && unmatched > 1, 'the premise: room for the give-backs below');
            await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross));
            // Given back before anything matched nothing: it returns to the covering credit.
            await payments.recordReversal(reversalOf('du_a', 'pi_paid', gross, 5, GIVEN_BACK_AT));
            const { replacement } = await cancelInvoice(invoiceId, { treatment: REVERSE_CHARGE });
            assert.ok(replacement);
            await payments.recordRefund(refundOf('re_1', 'pi_paid', unmatched));
            await payments.recordReversal(reversalOf('du_b', 'pi_late', gross));
            assert.deepEqual(
                (await payments.listCases({ state: 'open', subscriberId }, { limit: 10 })).map(
                    (each) => [each.gatewayRef, each.amount],
                ),
                [['du_a', unmatched]],
                'the premise: the lifted cover met the credit paid out',
            );
            assert.equal(await payments.owedBy(replacement.id), sumToCents(net, -5));

            const later = await payments.recordReversal(
                reversalOf('du_a', 'pi_paid', gross, 6, GIVEN_BACK_AT),
            );

            assert.ok(later.outcome === 'recorded' && later.reinstatement);
            assert.deepEqual(
                [
                    later.reinstatement.closedCases,
                    later.reinstatement.invoices,
                    later.reversal.reinstatedToCases,
                ],
                [[], [], 1],
            );
            assert.equal(
                (await payments.listCases({ state: 'open', subscriberId }, { limit: 10 })).length,
                1,
            );
            assert.equal(await payments.owedBy(replacement.id), sumToCents(net, -5));
        });

        // @requirement SC-PRIC-095
        test('a cancellation interrupted before it ends leaves none of it, and hands its numbers back', async (t) => {
            const account = await paidOnce(t, 'tenant-cancel-interrupted');
            if (!account) return;
            const { invoices, payments, invoiceId, gross, subscriberId } = account;

            await assert.rejects(
                cancelInvoice(invoiceId, { treatment: REVERSE_CHARGE, fail: true }),
                /the run that cancelled it failed/,
            );

            assert.equal(await invoices.findCancellation(invoiceId), null);
            assert.deepEqual(
                (await invoices.listBySubscriber(subscriberId)).map((each) => each.id),
                [invoiceId],
            );
            assert.deepEqual(await sharesByRef(invoiceId), [['pi_paid', gross]]);
            assert.equal(await payments.owedBy(invoiceId), 0);
            assert.deepEqual(await openCredits(payments, subscriberId), []);
            const again = await cancelInvoice(invoiceId);
            assert.equal(again.cancellationInvoice.number, 'EX-2026-000002');
        });

        // @requirement SC-PRIC-036
        test('a cancelled invoice is not collected, and no invoice of its chain is while an attempt for one of them is on its way', async (t) => {
            const account = await payable(t, 'tenant-cancel-collect');
            if (!account) return;
            const { collections, attempts, ids } = account;
            const invoiceId = ids[0]!;
            const { replacement } = await cancelInvoice(invoiceId);
            assert.ok(replacement);
            await deliver(replacement.id);
            const due = async () =>
                (await collections.listDue('2026-12-31', { limit: 100 })).filter((id) =>
                    [invoiceId, replacement.id].includes(id),
                );

            assert.deepEqual(await due(), [], 'collected beside the attempt on its way');
            assert.equal(await collections.startAttempt(attemptOf(replacement.id)), null);
            assert.equal(await collections.startAttempt(attemptOf(invoiceId)), null);

            await collections.recordOutcome(attempts[0]!.id, FAILURE, STARTED_AT);

            assert.deepEqual(await due(), [replacement.id]);
            assert.equal(
                await collections.plan(planOf(invoiceId, { after: 1 })),
                null,
                'a cancelled invoice was planned again',
            );
            const started = await collections.startAttempt(attemptOf(replacement.id));
            assert.equal(started?.attempt, 1);
        });

        // @requirement SC-PRIC-036
        test('a planned attempt of an invoice cancelled since is not sent', async (t) => {
            const account = await collectable(t, 'tenant-cancel-planned');
            if (!account) return;
            const { collections, ids } = account;
            const planned = await collections.plan(planOf(ids[0]!));
            assert.ok(planned);

            await cancelInvoice(ids[0]!, { replace: false });

            assert.equal(await collections.submitPlanned(planned.id, STARTED_AT), null);
            assert.deepEqual(
                (await collections.listDue('2026-12-31', { limit: 100 })).filter(
                    (id) => id === ids[0],
                ),
                [],
            );
        });

        // @requirement SC-PRIC-036
        // @requirement SC-PRIC-085
        test('nothing of a chain is collected again with a payment method one of its payments was reversed on', async (t) => {
            const account = await paidOnce(t, 'tenant-cancel-reversed-method');
            if (!account) return;
            const { collections, payments, attempt, gross, invoiceId } = account;
            await payments.recordReversal(reversalOf('du_1', 'pi_paid', gross));
            await collections.markReversed(attempt.id, REVERSED_AT);
            const { replacement } = await cancelInvoice(invoiceId);
            assert.ok(replacement);
            await deliver(replacement.id);

            assert.equal(
                await collections.startAttempt(attemptOf(replacement.id)),
                null,
                'collected again with the payment method its predecessor was reversed on',
            );
            const another = await collections.startAttempt({
                ...attemptOf(replacement.id),
                paymentMethodId: 'payment-method-another',
            });
            assert.equal(another?.paymentMethodId, 'payment-method-another');
        });

        // @requirement SC-PRIC-036
        test('a payment event meeting the cancellation of the replacement settles the invoice that stands once it has the turn', async (t) => {
            const { adapter } = harness;
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no pessimistic-locking capability');
                return;
            }
            const account = await payable(t, 'tenant-cancel-race');
            if (!account) return;
            const { collections, payments, attempts, grosses, paymentOf, ids, subscriberId } =
                account;
            const first = await cancelInvoice(ids[0]!);
            assert.ok(first.replacement);
            // The replacement is collected once its predecessor's attempt failed.
            await collections.recordOutcome(attempts[0]!.id, FAILURE, STARTED_AT);
            await deliver(first.replacement.id);
            const collecting = await collections.startAttempt(attemptOf(first.replacement.id));
            assert.ok(collecting, 'the replacement was not collected');

            // The cancellation of the replacement holds the chain's turn — its
            // first invoice's, another row than the replacement's own — while
            // the payment the replacement was collected for arrives.
            const cancelling = cancelInvoice(first.replacement.id, { pause: LOCK_HOLD_MS });
            await sleep(LOCK_HOLD_MS / 3);
            const paying = payments.recordPayment(paymentOf(collecting, 'pi_race', grosses[0]!));
            const [second] = await Promise.all([cancelling, paying]);

            assert.ok(second.replacement);
            assert.deepEqual(
                [
                    await payments.owedBy(first.replacement.id),
                    await payments.owedBy(second.replacement.id),
                ],
                [0, 0],
                'the payment settled a replacement cancelled under it',
            );
            assert.deepEqual(await sharesByRef(second.replacement.id), [['pi_race', grosses[0]]]);
            assert.deepEqual(await openCredits(payments, subscriberId), []);
        });

        // @requirement SC-PRIC-036
        test('two cancellations of an invoice at the same moment: one is written, the other is refused', async (t) => {
            const { adapter } = harness;
            if (!adapter.capabilities.transactions || !adapter.capabilities.pessimisticLocking) {
                t.skip('adapter declares no pessimistic-locking capability');
                return;
            }
            const account = await payable(t, 'tenant-cancel-two-at-once');
            if (!account) return;
            const { invoices, ids, subscriberId } = account;

            const outcomes = await Promise.allSettled([
                cancelInvoice(ids[0]!, { pause: LOCK_HOLD_MS }),
                cancelInvoice(ids[0]!, { pause: LOCK_HOLD_MS }),
            ]);

            assert.deepEqual(outcomes.map((each) => each.status).sort(), ['fulfilled', 'rejected']);
            const refused = outcomes.find((each) => each.status === 'rejected');
            refusedAs(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ALREADY_CANCELLED)(
                refused?.status === 'rejected' ? refused.reason : null,
            );
            assert.equal((await invoices.listBySubscriber(subscriberId)).length, 3);
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
            const settings = read?.settings;
            assert.ok(typeof settings === 'object' && settings !== null && 'vatRate' in settings);
            assert.equal(settings.vatRate, 20);
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

        describe('a feature withdrawal', () => {
            const ANNOUNCED_AT = new Date('2026-05-04T08:15:00.125Z');
            const WITHDRAWAL: NewFeatureWithdrawal = {
                featureKey: 'BANK_SYNC',
                reason: 'The bank interface the feature depends on has been switched off.',
                effectiveFrom: new Date('2026-05-10T00:00:00.000Z'),
                reductions: [
                    { kind: 'plan', key: 'PRO', billingCycle: 'MONTHLY', amountNet: 4.5 },
                    { kind: 'bundle', key: 'SYNC_PLUS', billingCycle: 'YEARLY', amountNet: 30 },
                ],
                announcedAt: ANNOUNCED_AT,
                announcedBy: 'super-admin:ops@example.com',
            };
            const LIFT = {
                liftedFrom: new Date('2026-06-01T00:00:00.000Z'),
                liftedAt: new Date('2026-05-28T09:00:00.500Z'),
                liftedBy: 'super-admin:ops@example.com',
            };
            const noticeOf = (withdrawalId: string): NoticeToRecord => ({
                tenantId: 'tenant-withdrawn',
                subscriptionId: 'sub-withdrawn',
                kind: 'feature-withdrawn',
                subject: withdrawalId,
                content: { withdrawalId },
            });

            /** A scenario of the withdrawal, skipped where the harness declares it has none. */
            function scenario(
                name: string,
                body: (
                    withdrawals: FeatureWithdrawalRepository,
                    notices: SubscriptionNoticeRepository,
                ) => Promise<void>,
            ): void {
                test(name, async (t) => {
                    const withdrawals = harness.adapter.featureWithdrawals;
                    if (!withdrawals) {
                        missing(t, 'featureWithdrawals');
                        return;
                    }
                    const notices = harness.adapter.subscriptionNotices;
                    if (!notices) {
                        missing(t, 'subscriptionNotices');
                        return;
                    }
                    await body(withdrawals, notices);
                });
            }

            /** Created, which a scenario that withdraws a feature nobody has withdrawn expects. */
            async function created(
                withdrawals: FeatureWithdrawalRepository,
                data: NewFeatureWithdrawal = WITHDRAWAL,
                tx?: TransactionContext,
            ) {
                const withdrawal = await withdrawals.create(data, tx);
                assert.ok(withdrawal, `${data.featureKey} is not withdrawn yet, so it is created`);
                return withdrawal;
            }

            scenario('is kept with its reductions, when and by whom', async (withdrawals) => {
                const withdrawal = await created(withdrawals);
                assert.ok(withdrawal.id, 'the adapter assigns the id');
                assert.equal(withdrawal.featureKey, WITHDRAWAL.featureKey);
                assert.equal(withdrawal.reason, WITHDRAWAL.reason);
                assert.equal(
                    withdrawal.effectiveFrom.toISOString(),
                    WITHDRAWAL.effectiveFrom.toISOString(),
                );
                assert.deepEqual(withdrawal.reductions, WITHDRAWAL.reductions);
                assert.equal(withdrawal.announcedAt.toISOString(), ANNOUNCED_AT.toISOString());
                assert.equal(withdrawal.announcedBy, WITHDRAWAL.announcedBy);
                assert.equal(withdrawal.liftedFrom, null, 'not lifted');
                assert.equal(withdrawal.liftedAt, null);
                assert.equal(withdrawal.liftedBy, null);
                assert.equal(withdrawal.toldAt, null, 'nobody told yet');
                assert.deepEqual(await withdrawals.findById(withdrawal.id), withdrawal);
                assert.equal(await withdrawals.findById('no-such-withdrawal'), null);
            });

            scenario(
                'holds a feature to one withdrawal not lifted, however many are announced at once',
                async (withdrawals) => {
                    const both = await Promise.all([
                        withdrawals.create(WITHDRAWAL),
                        withdrawals.create(WITHDRAWAL),
                    ]);
                    assert.equal(
                        both.filter((withdrawal) => withdrawal !== null).length,
                        1,
                        'one of two announcements at the same moment lands',
                    );
                    assert.equal(
                        await withdrawals.create(WITHDRAWAL),
                        null,
                        'and a later one meets it',
                    );
                    await created(withdrawals, { ...WITHDRAWAL, featureKey: 'OTHER_FEATURE' });
                    assert.deepEqual(
                        (await withdrawals.list())
                            .map((withdrawal) => withdrawal.featureKey)
                            .sort(),
                        ['BANK_SYNC', 'OTHER_FEATURE'],
                        'another feature is withdrawn beside it',
                    );
                },
            );

            scenario(
                'is lifted once, and the feature can be withdrawn again afterwards',
                async (withdrawals) => {
                    const withdrawal = await created(withdrawals);

                    const lifted = await withdrawals.lift(withdrawal.id, LIFT);

                    assert.ok(lifted, 'the withdrawal is lifted');
                    assert.equal(lifted.liftedFrom?.toISOString(), LIFT.liftedFrom.toISOString());
                    assert.equal(lifted.liftedAt?.toISOString(), LIFT.liftedAt.toISOString());
                    assert.equal(lifted.liftedBy, LIFT.liftedBy);
                    assert.deepEqual(
                        { ...lifted, liftedFrom: null, liftedAt: null, liftedBy: null },
                        withdrawal,
                        'and nothing else of it changes',
                    );
                    assert.deepEqual(await withdrawals.findById(withdrawal.id), lifted);
                    assert.equal(
                        await withdrawals.lift(withdrawal.id, {
                            ...LIFT,
                            liftedFrom: new Date('2026-07-01T00:00:00.000Z'),
                        }),
                        null,
                        'a second lift does not move the date the first recorded',
                    );
                    assert.equal(
                        (await withdrawals.findById(withdrawal.id))?.liftedFrom?.toISOString(),
                        LIFT.liftedFrom.toISOString(),
                    );
                    assert.equal(await withdrawals.lift('no-such-withdrawal', LIFT), null);
                    await created(withdrawals, {
                        ...WITHDRAWAL,
                        effectiveFrom: LIFT.liftedFrom,
                        announcedAt: LIFT.liftedAt,
                    });
                },
            );

            scenario('is listed with the most recently announced first', async (withdrawals) => {
                const first = await created(withdrawals);
                const second = await created(withdrawals, {
                    ...WITHDRAWAL,
                    featureKey: 'LATER_FEATURE',
                    announcedAt: new Date('2026-05-20T00:00:00.000Z'),
                });
                assert.deepEqual(
                    (await withdrawals.list()).map((withdrawal) => withdrawal.id),
                    [second.id, first.id],
                );
            });

            scenario(
                'is marked told with its notices in one transaction, or not at all',
                async (withdrawals, notices) => {
                    const withdrawal = await created(withdrawals);
                    const TOLD_AT = new Date('2026-05-04T08:15:01.250Z');
                    await assert.rejects(
                        harness.adapter.transactionRunner.run(async (tx) => {
                            assert.ok(await withdrawals.markTold(withdrawal.id, TOLD_AT, tx));
                            await notices.record([noticeOf(withdrawal.id)], TOLD_AT, tx);
                            throw new Error('rolled back');
                        }),
                        /rolled back/,
                    );
                    assert.equal(
                        (await withdrawals.findById(withdrawal.id))?.toldAt,
                        null,
                        'not marked told',
                    );
                    assert.deepEqual(
                        await notices.listForSubscription('sub-withdrawn'),
                        [],
                        'and no notice',
                    );

                    await harness.adapter.transactionRunner.run(async (tx) => {
                        assert.ok(await withdrawals.markTold(withdrawal.id, TOLD_AT, tx));
                        await notices.record([noticeOf(withdrawal.id)], TOLD_AT, tx);
                    });
                    assert.equal(
                        (await withdrawals.findById(withdrawal.id))?.toldAt?.toISOString(),
                        TOLD_AT.toISOString(),
                    );
                    const [notice] = await notices.listForSubscription('sub-withdrawn');
                    assert.equal(notice?.kind, 'feature-withdrawn');
                    assert.deepEqual(notice?.content, { withdrawalId: withdrawal.id });
                },
            );

            scenario('is marked told once, however many mark it at once', async (withdrawals) => {
                const withdrawal = await created(withdrawals);
                const marks = await Promise.all([
                    withdrawals.markTold(withdrawal.id, new Date('2026-05-04T08:16:00.000Z')),
                    withdrawals.markTold(withdrawal.id, new Date('2026-05-04T08:17:00.000Z')),
                ]);
                assert.deepEqual(
                    marks.filter(Boolean).length,
                    1,
                    'of two marking it at the same moment, one does',
                );
                const told = (await withdrawals.findById(withdrawal.id))?.toldAt;
                assert.ok(told, 'marked told');
                assert.equal(
                    await withdrawals.markTold(withdrawal.id, new Date('2026-05-05T00:00:00.000Z')),
                    false,
                    'and a later mark does not move it',
                );
                assert.equal(
                    (await withdrawals.findById(withdrawal.id))?.toldAt?.toISOString(),
                    told.toISOString(),
                );
                assert.equal(await withdrawals.markTold('no-such-withdrawal', new Date()), false);
            });

            scenario(
                'is lifted in the transaction it is given, or not at all',
                async (withdrawals) => {
                    const withdrawal = await created(withdrawals);
                    await assert.rejects(
                        harness.adapter.transactionRunner.run(async (tx) => {
                            assert.ok(await withdrawals.lift(withdrawal.id, LIFT, tx));
                            throw new Error('rolled back');
                        }),
                        /rolled back/,
                    );
                    assert.equal(
                        (await withdrawals.findById(withdrawal.id))?.liftedFrom,
                        null,
                        'still not lifted',
                    );
                },
            );
        });

        describe('a booking cancelled for a later date, ended at once', () => {
            test('ends at the moment named, and only while its cancellation is the one read', async (t) => {
                const repository = harness.adapter.subscriptionBundleRepository;
                const { seed } = harness;
                if (!repository?.endNow || !seed.createBundleVersion) {
                    missing(t, 'bookingsEndedNow');
                    return;
                }
                const { planVersionId } = await seed.createPlanVersion({
                    planKey: 'END_ADD_ON',
                    version: 1,
                    quotas: {},
                    features: [],
                    published: true,
                });
                const { bundleVersionId } = await seed.createBundleVersion({
                    bundleKey: 'ENDED_AT_ONCE',
                    features: ['BANK_SYNC'],
                });
                const { subscriptionId } = await seed.createSubscription({
                    tenantId: 'tenant-ended-booking',
                    plan: 'END_ADD_ON',
                    planVersionId,
                });
                const booking = (startedAt: string) =>
                    repository.add({
                        subscriptionId,
                        bundleVersionId,
                        startedAt: new Date(startedAt),
                        minimumTermEndsAt: new Date('2027-02-01T00:00:00.000Z'),
                        billingCycle: 'MONTHLY',
                        currentPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
                        currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
                    });
                const declaredFor = new Date('2027-02-01T00:00:00.000Z');
                const cancelledBooking = await booking('2026-02-01T00:00:00.000Z');
                const cancelled = await repository.cancel(cancelledBooking.id, {
                    canceledAt: new Date('2026-04-10T00:00:00.000Z'),
                    canceledEffectiveAt: declaredFor,
                });
                const at = new Date('2026-05-12T14:30:00.250Z');

                assert.equal(
                    await repository.endNow(cancelledBooking.id, {
                        at,
                        expectedCanceledEffectiveAt: new Date('2027-03-01T00:00:00.000Z'),
                    }),
                    null,
                    'a cancellation other than the one read is left as it is',
                );
                const ended = await repository.endNow(cancelledBooking.id, {
                    at,
                    expectedCanceledEffectiveAt: declaredFor,
                });

                assert.ok(ended, 'the booking ends');
                assert.equal(ended.canceledAt?.toISOString(), at.toISOString());
                assert.equal(ended.canceledEffectiveAt?.toISOString(), at.toISOString());
                /** A booking without its cancellation and the moment it was last written. */
                const unended = ({
                    canceledAt: _canceledAt,
                    canceledEffectiveAt: _effectiveAt,
                    updatedAt: _written,
                    ...rest
                }: typeof cancelled) => rest;
                assert.deepEqual(unended(ended), unended(cancelled), 'nothing else of it changes');
                assert.equal(
                    (
                        await repository.findById(cancelledBooking.id)
                    )?.canceledEffectiveAt?.toISOString(),
                    at.toISOString(),
                    'and read so afterwards',
                );
                assert.equal(
                    await repository.endNow(cancelledBooking.id, {
                        at: new Date('2026-05-20T00:00:00.000Z'),
                        expectedCanceledEffectiveAt: declaredFor,
                    }),
                    null,
                    'a second end from the cancellation it has left claims nothing',
                );

                const running = await booking('2026-03-01T00:00:00.000Z');
                assert.equal(
                    await repository.endNow(running.id, {
                        at,
                        expectedCanceledEffectiveAt: declaredFor,
                    }),
                    null,
                    'a booking not cancelled is not ended here',
                );
                assert.equal(
                    (await repository.findById(running.id))?.canceledAt,
                    null,
                    'and stays uncancelled',
                );
                assert.equal(
                    await repository.endNow(NO_SUCH_BOOKING, {
                        at,
                        expectedCanceledEffectiveAt: declaredFor,
                    }),
                    null,
                );
            });
        });

        describe('a subscription cancelled for a later date, ended at once', () => {
            test('ends at the moment named, and only while its cancellation is the one read', async (t) => {
                const writer = harness.adapter.tenantSubscriptionWrite;
                if (!writer?.endNow) {
                    missing(t, 'subscriptionsEndedNow');
                    return;
                }
                const { planVersionId } = await harness.seed.createPlanVersion({
                    planKey: 'END_PLAN',
                    version: 1,
                    quotas: {},
                    features: ['BANK_SYNC'],
                    published: true,
                });
                const subscriptionIn = (tenantId: string) =>
                    harness.seed.createSubscription({
                        tenantId,
                        plan: 'END_PLAN',
                        planVersionId,
                        status: 'ACTIVE',
                    });
                await subscriptionIn('tenant-ended');
                const declaredFor = new Date('2027-01-01T00:00:00.000Z');
                await writer.cancelSubscription('tenant-ended', {
                    canceledAt: new Date('2026-04-10T00:00:00.000Z'),
                    effectiveAt: declaredFor,
                    terminateNow: false,
                });
                const at = new Date('2026-05-12T14:30:00.250Z');

                const moved = await writer.endNow('tenant-ended', {
                    at,
                    expectedCanceledEffectiveAt: new Date('2027-02-01T00:00:00.000Z'),
                });
                assert.equal(moved.ended, false, 'a cancellation other than the one read is left');
                assert.equal(moved.canceledEffectiveAt?.toISOString(), declaredFor.toISOString());
                assert.equal(moved.status, 'ACTIVE');

                const ended = await writer.endNow('tenant-ended', {
                    at,
                    expectedCanceledEffectiveAt: declaredFor,
                });
                assert.deepEqual(
                    {
                        ended: ended.ended,
                        canceledAt: ended.canceledAt?.toISOString(),
                        canceledEffectiveAt: ended.canceledEffectiveAt?.toISOString(),
                        status: ended.status,
                    },
                    {
                        ended: true,
                        canceledAt: at.toISOString(),
                        canceledEffectiveAt: at.toISOString(),
                        status: 'CANCELED',
                    },
                );
                const stored =
                    await harness.adapter.subscriptionRepository.findByTenantId('tenant-ended');
                assert.equal(stored?.canceledEffectiveAt?.toISOString(), at.toISOString());
                assert.equal(stored?.status, 'CANCELED');
                const again = await writer.endNow('tenant-ended', {
                    at: new Date('2026-05-20T00:00:00.000Z'),
                    expectedCanceledEffectiveAt: declaredFor,
                });
                assert.equal(again.ended, false, 'a second end claims nothing');
                assert.equal(again.canceledEffectiveAt?.toISOString(), at.toISOString());

                await subscriptionIn('tenant-running');
                const running = await writer.endNow('tenant-running', {
                    at,
                    expectedCanceledEffectiveAt: declaredFor,
                });
                assert.equal(
                    running.ended,
                    false,
                    'a subscription not cancelled is not ended here',
                );
                assert.equal(running.canceledEffectiveAt, null);
                assert.equal(running.status, 'ACTIVE');
            });
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

        describe("a switch scheduled for the end of a booking's term", () => {
            test('stands beside the version it is on, from that version only, once, until it is cleared', async (t) => {
                const repository = harness.adapter.subscriptionBundleRepository;
                const { seed } = harness;
                if (
                    !repository?.scheduleVersion ||
                    !repository.unscheduleVersion ||
                    !repository.listScheduledVersionsDue ||
                    !seed.createBundleVersion
                ) {
                    missing(t, 'bookingsScheduled');
                    return;
                }
                const { planVersionId } = await seed.createPlanVersion({
                    planKey: 'SCHEDULE_ADD_ON',
                    version: 1,
                    quotas: {},
                    features: [],
                    published: true,
                });
                const booked = await seed.createBundleVersion({
                    bundleKey: 'SCHEDULED_FROM',
                    features: ['REPORTS'],
                });
                const taken = await seed.createBundleVersion({
                    bundleKey: 'SCHEDULED_TO',
                    features: [],
                });
                const bookingIn = async (tenantId: string) => {
                    const { subscriptionId } = await seed.createSubscription({
                        tenantId,
                        plan: 'SCHEDULE_ADD_ON',
                        planVersionId,
                    });
                    return repository.add({
                        subscriptionId,
                        bundleVersionId: booked.bundleVersionId,
                        startedAt: new Date('2026-02-01T00:00:00.000Z'),
                        minimumTermEndsAt: new Date('2027-02-01T00:00:00.000Z'),
                        billingCycle: 'MONTHLY',
                        currentPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
                        currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
                    });
                };
                const first = await bookingIn('tenant-scheduled-a');
                const second = await bookingIn('tenant-scheduled-b');
                assert.equal(first.pendingBundleVersionId, null, 'a booking starts with none');
                assert.equal(first.pendingVersionEffectiveAt, null);
                const at = new Date('2027-02-01T00:00:00.000Z');
                const earlier = new Date('2026-04-01T00:00:00.000Z');

                const scheduled = await repository.scheduleVersion(first.id, {
                    from: booked.bundleVersionId,
                    to: taken.bundleVersionId,
                    effectiveAt: at,
                });

                assert.ok(scheduled, 'the switch is scheduled');
                assert.equal(scheduled.pendingBundleVersionId, taken.bundleVersionId);
                assert.equal(scheduled.pendingVersionEffectiveAt?.toISOString(), at.toISOString());
                /** A booking without its schedule and the moment it was last written. */
                const unscheduled = ({
                    pendingBundleVersionId: _version,
                    pendingVersionEffectiveAt: _at,
                    updatedAt: _written,
                    ...rest
                }: typeof first) => rest;
                assert.deepEqual(
                    unscheduled(scheduled),
                    unscheduled(first),
                    'its version, period, terms and rhythm stay',
                );
                assert.equal(
                    await repository.scheduleVersion(first.id, {
                        from: booked.bundleVersionId,
                        to: taken.bundleVersionId,
                        effectiveAt: earlier,
                    }),
                    null,
                    'a second schedule while one stands claims nothing',
                );
                assert.equal(
                    await repository.scheduleVersion(second.id, {
                        from: taken.bundleVersionId,
                        to: booked.bundleVersionId,
                        effectiveAt: earlier,
                    }),
                    null,
                    'nor one from a version the booking is not on',
                );
                assert.ok(
                    await repository.scheduleVersion(second.id, {
                        from: booked.bundleVersionId,
                        to: taken.bundleVersionId,
                        effectiveAt: earlier,
                    }),
                );
                assert.equal(
                    (await repository.findById(first.id))?.pendingBundleVersionId,
                    taken.bundleVersionId,
                    'and read so afterwards',
                );

                const listDue = repository.listScheduledVersionsDue.bind(repository);
                const due = async (asOf: Date) =>
                    (await listDue(asOf)).map((booking) => booking.id);
                assert.deepEqual(await due(new Date(earlier.getTime() - 1)), [], 'none before');
                assert.deepEqual(await due(earlier), [second.id], 'one at its moment');
                assert.deepEqual(
                    await due(at),
                    [second.id, first.id],
                    'every tenant, oldest moment first',
                );

                const moved = await repository.moveToVersion?.(
                    first.id,
                    booked.bundleVersionId,
                    taken.bundleVersionId,
                );
                if (moved) {
                    assert.equal(
                        moved.pendingBundleVersionId,
                        taken.bundleVersionId,
                        'a move keeps the schedule, which the run clears after it',
                    );
                }
                assert.equal(
                    await repository.unscheduleVersion(first.id, booked.bundleVersionId),
                    null,
                    'a clear names the version scheduled, or claims nothing',
                );
                const cleared = await repository.unscheduleVersion(first.id, taken.bundleVersionId);
                assert.ok(cleared, 'the switch is cleared');
                assert.equal(cleared.pendingBundleVersionId, null);
                assert.equal(cleared.pendingVersionEffectiveAt, null);
                assert.equal(
                    cleared.bundleVersionId,
                    moved ? taken.bundleVersionId : booked.bundleVersionId,
                    'and the version stays as it is',
                );
                assert.equal(
                    await repository.unscheduleVersion(first.id, taken.bundleVersionId),
                    null,
                    'a second clear claims nothing',
                );
                assert.deepEqual(await due(at), [second.id], 'and it is no longer due');
                assert.equal(
                    await repository.scheduleVersion(NO_SUCH_BOOKING, {
                        from: booked.bundleVersionId,
                        to: taken.bundleVersionId,
                        effectiveAt: at,
                    }),
                    null,
                );
                assert.equal(
                    await repository.unscheduleVersion(NO_SUCH_BOOKING, taken.bundleVersionId),
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
