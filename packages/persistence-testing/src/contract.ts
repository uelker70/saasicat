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
    AppliedSettingsValues,
    ConfirmedPaymentMethod,
    CreateCheckoutOfferData,
    CreateSubscriberData,
    NewContractLineItemData,
    NewSubscriptionContractData,
    PaymentEventClaim,
    RecordSubscriberPaymentMethodData,
    SubscriberPaymentMethodRecord,
    SubscriberPaymentMethodReference,
    SubscriptionContractParties,
    TransactionContext,
} from '@saasicat/core';
import type {
    ContractGap,
    PersistenceAdapterContractOptions,
    PersistenceContractHarness,
} from './harness.types.js';

const LOCK_HOLD_MS = 150;

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
    checkoutOffers: {
        reason: 'adapter provides no CheckoutOfferRepository',
        present: ({ adapter }) => Boolean(adapter.checkoutOfferRepository),
    },
    appliedSettings: {
        reason: 'adapter provides no AppliedSettingsPort',
        present: ({ adapter }) => Boolean(adapter.appliedSettings),
    },
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

        test('findLatestLive resolves the live version, not superseded or draft', async () => {
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

            const live = await adapter.planVersionRepository.findLatestLive('PRO');
            assert.ok(live, 'live version expected');
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
                'a second cancellation must be refused',
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
                'a plan key is taken once',
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
                'a bundle key is taken once',
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
            assert.equal(await entitlementVersions.findLatestLive('NO_SUCH_PLAN'), null);
            if (entitlementVersions.findActive) {
                assert.equal(
                    await entitlementVersions.findActive('NO_SUCH_PLAN', new Date()),
                    null,
                );
            }
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
                    (await entitlementVersions.findLatestLive('RETIRING'))?.features ?? null,
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

        test('countByPlanVersionId counts current AND pending bindings in one query', async (t) => {
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
                tenantId: 'tenant-pending',
                plan: 'PRO',
                planVersionId: v1.planVersionId,
                pendingPlanVersionId: v2.planVersionId,
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

            const changed = await subscribers.updateContact(created.id, {
                city: 'Bremen',
                addressLine2: null,
                invoiceEmail: 'buchhaltung@kontakt.example',
            });

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
                await subscribers.updateContact('subscriber-nobody-created', { city: 'Kiel' }),
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
            const at = (day: number) => new Date(Date.UTC(2026, 8, day));

            const first = await subscribers.correctIdentity(created.id, {
                corrected: { legalName: 'Müller GmbH', vatId: 'DE123456789', taxNumber: null },
                reason: 'Umlaut lost when the registration was typed',
                correctedBy: 'operator:anna',
                correctedAt: at(1),
            });
            // `taxNumber` was already null, so it moved nothing and is not recorded.
            assert.deepEqual(
                first?.correction && {
                    previous: first.correction.previous,
                    corrected: first.correction.corrected,
                    reason: first.correction.reason,
                    correctedBy: first.correction.correctedBy,
                    correctedAt: first.correction.correctedAt.getTime(),
                },
                {
                    previous: { legalName: 'Mueller GmbH', vatId: null },
                    corrected: { legalName: 'Müller GmbH', vatId: 'DE123456789' },
                    reason: 'Umlaut lost when the registration was typed',
                    correctedBy: 'operator:anna',
                    correctedAt: at(1).getTime(),
                },
            );
            assert.equal(first?.subscriber.legalName, 'Müller GmbH');
            assert.equal((await subscribers.findById(created.id))?.vatId, 'DE123456789');

            const unchanged = await subscribers.correctIdentity(created.id, {
                corrected: { legalName: 'Müller GmbH' },
                reason: 'Clicked twice',
                correctedBy: 'operator:anna',
                correctedAt: at(2),
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
                correctedAt: at(3),
            });
            const listed = await subscribers.listCorrections(created.id);
            assert.deepEqual(
                listed.map((correction) => correction.reason),
                [
                    'Wrong VAT id on the first correction',
                    'Umlaut lost when the registration was typed',
                ],
                'corrections come back the latest first, and only the two that moved something',
            );
            assert.equal(
                await subscribers.correctIdentity('subscriber-nobody-created', {
                    corrected: { legalName: 'Niemand' },
                    reason: 'none',
                    correctedBy: 'operator:anna',
                    correctedAt: at(4),
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
                            correctedAt: new Date(),
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
            assert.equal(listed.length, 2);
            const replaced = listed.map((correction) => correction.previous.legalName).sort();
            const written = listed.map((correction) => correction.corrected.legalName);
            const current = (await subscribers.findById(created.id))?.legalName;
            // One replaced the original; the other replaced what the first wrote.
            assert.ok(replaced.includes('Original GmbH'), JSON.stringify(listed));
            const secondReplaced = replaced.find((name) => name !== 'Original GmbH');
            assert.ok(
                secondReplaced !== undefined && written.includes(secondReplaced),
                `a correction recorded a value it did not replace: ${JSON.stringify(listed)}`,
            );
            assert.ok(current !== undefined && written.includes(current));
            assert.notEqual(secondReplaced, current);
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
                correctedAt: new Date(),
            });

            const readBack = await contracts.findById(contract.id);
            assert.equal(readBack?.subscriberId, subscriber.id);
            assert.equal(
                readBack?.subscriber.legalName,
                'Vorher GmbH',
                'the contract followed a correction of the live record',
            );
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
    });
}
