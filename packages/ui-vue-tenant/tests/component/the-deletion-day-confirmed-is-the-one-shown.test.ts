import { afterEach, describe, expect, test } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, type App } from 'vue';
import type { AnnouncedDeletion, TenantFeatureWithdrawal } from '@saasicat/core';
import type { HttpClient, UsageSnapshotShape } from '@saasicat/ui-vue';

import TenantPlanSection from '../../src/TenantPlanSection.vue';
import FeatureWithdrawnNotices from '../../src/tenant-plan-section/FeatureWithdrawnNotices.vue';
import TenantPlanCardHeader from '../../src/tenant-plan-section/TenantPlanCardHeader.vue';
import { DEFAULT_I18N_DE, DEFAULT_I18N_EN } from '../../src/default-i18n';
import { TENANT_I18N_KEY } from '../../src/tenant-i18n';
import { AHEAD, aRunningSubscription } from './support/running-subscription.js';
import { answered, type UsageAsRead } from './support/server-days.js';

// Before a tenant confirms that its subscription ends — by cancelling it, or
// by ending it at once while a feature is withdrawn — it reads how long its
// data can only be read and the day it is deleted on, and what it read is what
// it confirms: the deletion day travels with the click, and where the server
// works out another one meanwhile the tenant is shown the new one and asked
// again. Afterwards the plan card repeats the day it was told. Where nothing
// is deleted — a booking ending alone, an installation that records no end —
// nothing is said about deletion and no day is sent.
//
// The days are set far from anything a browser could count from the moments
// (the subscription ends in 2099, its data is deleted in 2027), so a page that
// worked a day out rather than writing the one the server named shows a day
// that appears nowhere below.

const TOLD: AnnouncedDeletion = {
    readOnlyDays: 30,
    readOnlyUntil: '2027-01-29',
    deletesOn: '2027-01-30',
};
/** What the server works out instead, after the read-only period changed. */
const NOW_TOLD: AnnouncedDeletion = {
    readOnlyDays: 60,
    readOnlyUntil: '2027-03-30',
    deletesOn: '2027-03-31',
};

const sentenceOf = (deletion: AnnouncedDeletion, template = DEFAULT_I18N_EN.deletionAnnounced) =>
    template
        .replace('{readOnlyUntil}', deletion.readOnlyUntil)
        .replace('{deletesOn}', deletion.deletesOn);

const formatDate = (value: string | Date) => String(value).slice(0, 10);

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
});

const reply = (body: unknown, status = 200) => ({
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
});
const sent = (body: string | undefined): unknown =>
    body === undefined ? undefined : JSON.parse(body);
const dialogText = () => document.body.querySelector('.sp-dialog__panel')?.textContent ?? '';
const dialogButtonNamed = (label: string) =>
    [...document.body.querySelectorAll<HTMLButtonElement>('.sp-dialog__panel button')].find(
        (button) => button.textContent?.trim() === label,
    );

/** A subscription whose cancellation now would tell `deletion` (left out where it is `undefined`). */
function cancellable(
    deletion: AnnouncedDeletion | null | undefined,
    fields: Partial<UsageSnapshotShape['cancellation']> = {},
): UsageSnapshotShape {
    const cancellation: UsageAsRead['cancellation'] = {
        effectiveAt: AHEAD,
        termEndsAt: AHEAD,
        noticeDeadline: null,
        afterNoticeDeadline: false,
        ...fields,
    };
    // Left out rather than `undefined`, as a server that predates the days answers.
    if (deletion !== undefined) cancellation.deletion = deletion;
    return aRunningSubscription({ cancellation });
}

interface PlanServer {
    http: HttpClient;
    /** The bodies `POST /billing/cancel` was sent, in order. */
    cancelled: unknown[];
}

/**
 * Answers the plan section's reads with `usage`. With `changedTo`, the first
 * cancellation is refused as the server refuses one whose terms moved, and the
 * account reads as `changedTo` from then on.
 */
function aPlanServer(usage: UsageSnapshotShape, changedTo?: UsageSnapshotShape): PlanServer {
    const cancelled: unknown[] = [];
    let current = usage;
    let moved = changedTo;
    const http: HttpClient = async (url, init) => {
        if (url.endsWith('/cancel')) {
            cancelled.push(sent(init?.body));
            if (moved) {
                current = moved;
                moved = undefined;
                return reply(
                    {
                        code: 'CANCELLATION_TERMS_CHANGED',
                        message: 'The cancellation changed since it was shown.',
                        deletion: current.cancellation.deletion ?? null,
                    },
                    409,
                );
            }
            return reply({ canceledAt: AHEAD, canceledEffectiveAt: AHEAD, status: 'ACTIVE' });
        }
        if (url.endsWith('/usage')) return reply(current);
        if (url.endsWith('/version-offer')) return reply({ offer: null });
        return reply([]);
    };
    return { http, cancelled };
}

async function openTheCancellation(server: PlanServer, i18n = DEFAULT_I18N_EN) {
    const wrapper = mount(TenantPlanSection, {
        attachTo: document.body,
        props: {
            http: server.http,
            formatCurrency: (value: number) => `€ ${value.toFixed(2)}`,
            formatDate,
            i18n,
        },
    });
    mounted.push(wrapper);
    await flushPromises();
    await wrapper
        .findAll('button')
        .find((button) => button.text() === i18n.cancelSubscriptionButton)!
        .trigger('click');
    await flushPromises();
    return wrapper;
}

/** Confirms the open cancellation, with whatever date its button names. */
async function confirmTheCancellation() {
    const confirm = [
        ...document.body.querySelectorAll<HTMLButtonElement>('.sp-dialog__panel button'),
    ].at(-1);
    confirm!.click();
    await flushPromises();
}

/** The cancellation, where the server answers `deletion` as given: no sentence about deletion, and no day sent. */
async function saysNothingOfDeletionAndSendsNoDay(deletion: null | undefined) {
    const server = aPlanServer(cancellable(deletion));
    await openTheCancellation(server);

    expect(dialogText()).toContain(DEFAULT_I18N_EN.cancelConfirmTitle);
    expect(dialogText()).not.toContain('no longer change');
    expect(dialogText()).not.toContain('deleted');

    await confirmTheCancellation();

    expect(server.cancelled).toEqual([{ expectedEffectiveAt: AHEAD }]);
}

// @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
describe('the confirmation of a cancellation', () => {
    test('says until when the data can only be read and the day it is deleted, as the server named them', async () => {
        await openTheCancellation(aPlanServer(cancellable(TOLD)));

        expect(dialogText()).toContain(
            'After that you can still read your data until the end of 2027-01-29, but no longer change it. On 2027-01-30 it is deleted.',
        );
        expect(dialogText(), 'a day counted from the end').not.toContain('2099-07');
    });

    test('says it after a notice deadline as well', async () => {
        await openTheCancellation(
            aPlanServer(cancellable(TOLD, { noticeDeadline: AHEAD, afterNoticeDeadline: true })),
        );

        expect(dialogText()).toContain('The notice period for the running term ended');
        expect(dialogText()).toContain(sentenceOf(TOLD));
    });

    test('and while a retirement of the version is pending', async () => {
        const side = (planVersionId: string, version: number) => ({
            planKey: 'PRO',
            planVersionId,
            version,
            features: [],
            quotas: { users: 5 },
            monthlyNet: 29,
            yearlyNet: 290,
            validUntil: null,
            endsAt: null,
        });
        const usage = aRunningSubscription({
            cancellation: cancellable(TOLD).cancellation,
            retirement: {
                kind: 'version-retired',
                tenantId: 't-1',
                subscriptionId: 'sub-1',
                retirementId: 'r-1',
                retired: side('pv-1', 1),
                replacement: side('pv-2', 2),
                changes: [],
                billingCycle: 'MONTHLY',
                effectiveAt: AHEAD,
                lastDayToCancel: '2099-06-14',
            },
        });
        await openTheCancellation(aPlanServer(usage));

        expect(dialogText()).toContain('Because version 1 of your plan is being retired');
        expect(dialogText()).toContain(sentenceOf(TOLD));
    });

    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    test('sends the deletion day it showed beside the date', async () => {
        const server = aPlanServer(cancellable(TOLD));
        await openTheCancellation(server);

        await confirmTheCancellation();

        expect(server.cancelled).toEqual([
            { expectedEffectiveAt: AHEAD, expectedDeletesOn: '2027-01-30' },
        ]);
        expect(document.body.querySelector('.sp-dialog__panel')).toBeNull();
    });

    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    test('where the server works out another day, shows the new one, and the next confirmation sends it', async () => {
        const server = aPlanServer(cancellable(TOLD), cancellable(NOW_TOLD));
        await openTheCancellation(server);

        await confirmTheCancellation();

        expect(dialogText()).toContain(sentenceOf(NOW_TOLD));
        expect(dialogText()).not.toContain(TOLD.deletesOn);
        expect(dialogText()).toContain(
            'The cancellation changed since it was shown. Look at it again before confirming it.',
        );

        await confirmTheCancellation();

        expect(server.cancelled).toEqual([
            { expectedEffectiveAt: AHEAD, expectedDeletesOn: '2027-01-30' },
            { expectedEffectiveAt: AHEAD, expectedDeletesOn: '2027-03-31' },
        ]);
    });

    test('where the server answers no deletion, says nothing of deletion and sends no day', async () => {
        await saysNothingOfDeletionAndSendsNoDay(null);
    });

    test('where the server predates the days, says nothing of deletion and sends no day', async () => {
        await saysNothingOfDeletionAndSendsNoDay(undefined);
    });
});

// ── The plan card of a cancelled subscription ──────────────────────────────

function aCardOf(fields: Partial<UsageSnapshotShape>) {
    const wrapper = mount(TenantPlanCardHeader, {
        props: {
            usage: aRunningSubscription(fields),
            currentPlanName: 'Pro',
            statusTone: 'positive' as const,
            statusLabel: 'Active',
            cycleLabel: 'Monthly',
            currentPriceEur: 29,
            currentPriceUnit: '/ mo',
            billsAgain: false,
            formatCurrency: (value: number) => `€ ${value}`,
            formatDate,
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

const CANCELLED = { canceledAt: '2026-03-01T00:00:00.000Z', canceledEffectiveAt: AHEAD };

describe('the plan card of a cancelled subscription', () => {
    test('repeats the last day the data can be read and the deletion day as they were told', () => {
        const strip = aCardOf({ ...CANCELLED, announcedDeletion: TOLD }).find(
            '.sp-plan-section__canceled',
        );

        expect(strip.text()).toContain(sentenceOf(TOLD));
        expect(strip.text()).toContain(DEFAULT_I18N_EN.canceledUnchanged);
    });

    test.each([
        ['none was told', null],
        ['the server predates the days', undefined],
    ])('where %s, says nothing of deletion', (_, announcedDeletion) => {
        const fields: Partial<UsageSnapshotShape> = { ...CANCELLED };
        if (announcedDeletion !== undefined) fields.announcedDeletion = announcedDeletion;
        const strip = aCardOf(fields).find('.sp-plan-section__canceled');

        expect(strip.text()).toContain(DEFAULT_I18N_EN.canceledUnchanged);
        expect(strip.text()).not.toContain('no longer change');
        expect(strip.text()).not.toContain('deleted');
    });

    test('where it is not cancelled, says nothing of deletion, whatever was told', () => {
        expect(aCardOf({ announcedDeletion: TOLD }).text()).not.toContain('deleted');
    });
});

// ── Ending at once while a feature is withdrawn ─────────────────────────────

const WITHDRAWAL: TenantFeatureWithdrawal = {
    withdrawalId: 'fw-1',
    featureKey: 'EXPORT',
    featureLabel: 'Export',
    reason: 'The service closed.',
    effectiveFrom: '2020-06-15T12:00:00.000Z',
    effectiveFromDays: { until: '2020-06-14', from: '2020-06-15' },
    liftedFrom: null,
    liftedFromDays: null,
    inEffect: true,
    lines: [
        {
            line: 'bundle',
            key: 'EXPORT_PLUS',
            label: 'Export plus',
            subscriptionBundleId: 'sb-1',
            billingCycle: 'MONTHLY',
            reductionNet: null,
            reduced: true,
            fromChange: null,
            fromChangeDays: null,
        },
    ],
    specialTerms: false,
    endable: { subscription: true, subscriptionBundleIds: ['sb-1'] },
};

interface EndServer {
    http: HttpClient;
    /** Each `POST …/end` with the body it was sent. */
    ended: Array<{ url: string; body: unknown }>;
}

/**
 * Answers what ending at once would do: the subscription tells `deletion`,
 * a booking nothing. With `changedTo`, the first end of the subscription is
 * refused as the server refuses one whose deletion day moved, and the preview
 * tells `changedTo` from then on.
 */
function anEndServer(
    deletion: AnnouncedDeletion | null,
    {
        mayEnd,
        changedTo,
        creditNet = 0,
    }: { mayEnd?: boolean; changedTo?: AnnouncedDeletion; creditNet?: number } = {},
): EndServer {
    const ended: Array<{ url: string; body: unknown }> = [];
    let told = deletion;
    let moved = changedTo;
    const http: HttpClient = async (url, init) => {
        if (url.endsWith('/feature-withdrawals')) return reply([WITHDRAWAL]);
        const booking = url.includes('/bookings/');
        const preview = {
            ...answered({ endsAt: '2020-06-20T12:00:00.000Z' }, ['endsAt']),
            creditNet,
            currency: 'EUR',
            deletion: booking ? null : told,
        };
        // `mayEnd` left out where it is not given, as a server that predates it answers.
        if (init?.method !== 'POST') {
            return reply(mayEnd === undefined ? preview : { ...preview, mayEnd });
        }
        ended.push({ url, body: sent(init.body) });
        if (moved && !booking) {
            told = moved;
            moved = undefined;
            return reply(
                {
                    code: 'CANCELLATION_TERMS_CHANGED',
                    message: 'The cancellation changed meanwhile.',
                    params: {},
                    deletion: told,
                },
                409,
            );
        }
        return reply({
            ...preview,
            withdrawalId: 'fw-1',
            subscriptionBundleId: booking ? 'sb-1' : null,
        });
    };
    return { http, ended };
}

/** The notices, in `i18n`, with the dialog of ending `what` at once open. */
async function askToEnd(server: EndServer, what: string, i18n = DEFAULT_I18N_EN) {
    const wrapper = mount(FeatureWithdrawnNotices, {
        attachTo: document.body,
        global: {
            plugins: [
                {
                    install: (app: App) =>
                        app.provide(
                            TENANT_I18N_KEY,
                            computed(() => i18n),
                        ),
                },
            ],
        },
        props: { http: server.http, formatCurrency: (n: number) => `€ ${n}`, formatDate },
    });
    mounted.push(wrapper);
    await flushPromises();
    await wrapper
        .findAll('button')
        .find((button) => button.text() === what)!
        .trigger('click');
    await flushPromises();
    return wrapper;
}

// @requirement SC-CANC-029 — A tenant that ends its subscription at once is told the deletion day first
describe('ending at once', () => {
    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    test('the subscription: says until when the data can only be read and the day it is deleted, and sends that day', async () => {
        const server = anEndServer(TOLD);
        await askToEnd(server, DEFAULT_I18N_EN.featureWithdrawnEndSubscription);

        expect(dialogText()).toContain(sentenceOf(TOLD));

        dialogButtonNamed(DEFAULT_I18N_EN.endAtOnceConfirm)!.click();
        await flushPromises();

        expect(server.ended).toEqual([
            {
                url: '/billing/feature-withdrawals/fw-1/end',
                body: { expectedDeletesOn: '2027-01-30' },
            },
        ]);
    });

    test('one booking: says nothing of deletion, and sends no day', async () => {
        const server = anEndServer(TOLD);
        await askToEnd(server, 'End Export plus now');

        expect(dialogText()).toContain('Export plus ends at once');
        expect(dialogText()).not.toContain('no longer change');
        expect(dialogText()).not.toContain('deleted');

        dialogButtonNamed(DEFAULT_I18N_EN.endAtOnceConfirm)!.click();
        await flushPromises();

        expect(server.ended).toEqual([
            { url: '/billing/feature-withdrawals/fw-1/bookings/sb-1/end', body: {} },
        ]);
    });

    test('where the installation names no deletion day, says nothing of deletion and sends none', async () => {
        const server = anEndServer(null);
        await askToEnd(server, DEFAULT_I18N_EN.featureWithdrawnEndSubscription);

        expect(dialogText()).not.toContain('deleted');

        dialogButtonNamed(DEFAULT_I18N_EN.endAtOnceConfirm)!.click();
        await flushPromises();

        expect(server.ended.map((end) => end.body)).toEqual([{}]);
    });

    // @requirement SC-CANC-031 — The deletion day a tenant confirmed is the one it was shown
    test('where the server works out another day, reads it again, shows the new one, and the next confirmation sends it', async () => {
        const server = anEndServer(TOLD, { changedTo: NOW_TOLD });
        await askToEnd(server, DEFAULT_I18N_EN.featureWithdrawnEndSubscription);

        dialogButtonNamed(DEFAULT_I18N_EN.endAtOnceConfirm)!.click();
        await flushPromises();

        expect(dialogText()).toContain(sentenceOf(NOW_TOLD));
        expect(dialogText()).not.toContain(TOLD.deletesOn);

        dialogButtonNamed(DEFAULT_I18N_EN.endAtOnceConfirm)!.click();
        await flushPromises();

        expect(server.ended.map((end) => end.body)).toEqual([
            { expectedDeletesOn: '2027-01-30' },
            { expectedDeletesOn: '2027-03-31' },
        ]);
        expect(document.body.querySelector('.sp-dialog__panel')).toBeNull();
    });

    test('the subscription: says what happens to the data last, after what is credited for the time after the end', async () => {
        await askToEnd(
            anEndServer(TOLD, { creditNet: 33.87 }),
            DEFAULT_I18N_EN.featureWithdrawnEndSubscription,
        );

        const paragraphs = [...document.body.querySelectorAll('.sp-dialog__panel p')].map(
            (paragraph) => paragraph.textContent?.trim(),
        );
        expect(paragraphs).toEqual([
            'Your subscription and every add-on end at once, on 2020-06-20. From then on, nothing it includes can be used.',
            '€ 33.87 net for the time already paid after that is credited to your account.',
            sentenceOf(TOLD),
        ]);
    });

    test('a user who may not end reads the same days', async () => {
        await askToEnd(
            anEndServer(TOLD, { mayEnd: false }),
            DEFAULT_I18N_EN.featureWithdrawnEndSubscription,
        );

        expect(dialogText()).toContain(sentenceOf(TOLD));
        expect(dialogText()).toContain(DEFAULT_I18N_EN.endAtOnceByAdministration);
    });
});

/** The cancellation and the end at once, in `i18n`, each say `sentence` with no placeholder left. */
async function bothDialogsSay(i18n: typeof DEFAULT_I18N_EN, sentence: string) {
    await openTheCancellation(aPlanServer(cancellable(TOLD)), i18n);
    expect(dialogText()).toContain(sentence);
    expect(dialogText()).not.toMatch(/[{}]/);

    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';

    await askToEnd(anEndServer(TOLD), i18n.featureWithdrawnEndSubscription, i18n);
    expect(dialogText()).toContain(sentence);
    expect(dialogText()).not.toMatch(/[{}]/);
}

// @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
// @requirement SC-CANC-029 — A tenant that ends its subscription at once is told the deletion day first
describe('in either language', () => {
    test('in German: the cancellation and the end at once fill in both days', async () => {
        await bothDialogsSay(
            DEFAULT_I18N_DE,
            'Danach können Sie Ihre Daten bis einschließlich 2027-01-29 nur noch lesen, nicht mehr ändern. Am 2027-01-30 werden sie gelöscht.',
        );
    });

    test('in English: the cancellation and the end at once fill in both days', async () => {
        await bothDialogsSay(
            DEFAULT_I18N_EN,
            'After that you can still read your data until the end of 2027-01-29, but no longer change it. On 2027-01-30 it is deleted.',
        );
    });
});
