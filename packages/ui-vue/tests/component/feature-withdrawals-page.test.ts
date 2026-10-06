// The withdrawn-features page answers the operator's question when a service
// the product depends on stops: who loses the feature from when, what do they
// pay less, and have they been told?
//
// These mount the page, the lift dialog and the withdraw dialog against stubbed
// resources and read what each shows: no withdrawal yet, one in effect beside
// one lifted, a list that is not one, and a preview with reductions to name.

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import FeatureWithdrawDialog from '../../src/features/feature-withdrawal/FeatureWithdrawDialog.vue';
import FeatureWithdrawalLiftDialog from '../../src/features/feature-withdrawal/FeatureWithdrawalLiftDialog.vue';
import FeatureWithdrawalsPage from '../../src/pages/FeatureWithdrawalsPage.vue';
import { featureWithdrawalTargetKeyOf } from '../../src/client/feature-withdrawal.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import {
    useFeatureWithdrawalAnnouncement,
    type FeatureWithdrawalAnnouncementFlow,
} from '../../src/vue/use-feature-withdrawal-announcement.js';
import { provideStubResources } from './support/stub-resources.js';

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const IN_EFFECT = {
    id: 'fw-1',
    featureKey: 'EXPORT',
    featureLabel: 'Data export',
    reason: 'The export service has been switched off.',
    effectiveFrom: iso(-2),
    liftedFrom: null,
    reductions: [],
    announcedAt: iso(-3),
    announcedBy: 'web:ops@example.com:admin',
    liftedAt: null,
    liftedBy: null,
    progress: { reached: 3, told: 2, endedAtOnce: 1 },
};
const LIFTED = {
    ...IN_EFFECT,
    id: 'fw-0',
    featureKey: 'FAX',
    featureLabel: 'Fax',
    reason: 'The fax gateway closed.',
    effectiveFrom: iso(-60),
    liftedFrom: iso(-30),
    liftedAt: iso(-31),
    liftedBy: 'web:ops@example.com:admin',
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle() {
    for (let i = 0; i < 3; i += 1) await nextTick();
    await new Promise((tick) => setTimeout(tick, 0));
}

function mountPage(list: () => Promise<unknown>) {
    const wrapper = mountWithQuasar(FeatureWithdrawalsPage as never, {
        global: {
            provide: provideStubResources({
                featureWithdrawals: { list },
                catalog: { features: async () => [] },
            } as never),
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

const buttonLabels = (wrapper: { findAll: (s: string) => { text: () => string }[] }) =>
    wrapper.findAll('button').map((b) => b.text());

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('FeatureWithdrawalsPage', () => {
    test('with nothing withdrawn, it says what a withdrawal does and offers one', async () => {
        const wrapper = mountPage(async () => []);
        await settle();
        expect(wrapper.text()).toMatch(/No feature withdrawn yet|Noch kein Feature zurückgezogen/);
        expect(buttonLabels(wrapper).join(' ')).toMatch(/Withdraw a feature|Feature zurückziehen/);
    });

    test('a withdrawal shows its reason, where it stands and how far it has come; only an unlifted one can be lifted', async () => {
        const wrapper = mountPage(async () => [IN_EFFECT, LIFTED]);
        await settle();
        const text = wrapper.text();
        expect(text).toContain('Data export (EXPORT)');
        expect(text).toContain('The export service has been switched off.');
        expect(text).toMatch(
            /3 subscriptions, 2 told, 1 ended at once|3 Abonnements, 2 informiert, 1 sofort beendet/,
        );
        expect(text).toMatch(/Withdrawn|Zurückgezogen/);
        expect(text).toMatch(/Lifted|Aufgehoben/);
        const lifts = buttonLabels(wrapper).filter((label) =>
            /(Lift|Aufheben)$/.test(label.trim()),
        );
        expect(lifts).toHaveLength(1);
    });

    // @requirement SC-UI-020 — A page never takes the whole screen down because data arrived in an unexpected shape
    test('a resource of the application’s own that answers another shape does not take the page down', async () => {
        const wrapper = mountPage(async () => ({ items: [IN_EFFECT] }));
        await settle();
        expect(wrapper.text()).toMatch(/Withdrawn features|Zurückgezogene Features/);
    });
});

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('lifting in the dialog', () => {
    test('a date left empty lifts at once', async () => {
        const lifted: unknown[] = [];
        const wrapper = mountWithQuasar(FeatureWithdrawalLiftDialog as never, {
            attachTo: document.body,
            props: {
                modelValue: true,
                row: IN_EFFECT,
                lift: async (row: { id: string }, liftedFrom: string | null) => {
                    lifted.push([row.id, liftedFrom]);
                    return { withdrawal: { id: row.id }, told: 2, failed: 0 };
                },
            },
        });
        mounted.push(wrapper);
        await settle();
        expect(document.body.textContent).toContain('Data export');
        const submit = [...document.querySelectorAll('button')].find((b) =>
            /(Lift|Aufheben)$/.test(b.textContent?.trim() ?? ''),
        );
        expect(submit, 'a lift button').toBeDefined();
        submit!.click();
        await settle();
        expect(lifted).toEqual([['fw-1', null]]);
    });
});

const PRO = {
    kind: 'plan',
    key: 'PRO',
    label: 'Pro',
    billingCycle: 'MONTHLY',
    lines: 2,
    lowestPriceNet: 49,
};

function previewOf(blockers: unknown[] = []) {
    return {
        feature: { key: 'EXPORT', label: 'Data export' },
        effectiveFrom: iso(10),
        asOf: iso(0),
        reached: [
            {
                tenantId: 't1',
                subscriptionId: 's-1',
                status: 'ACTIVE',
                lines: [],
                specialTerms: false,
            },
            {
                tenantId: 't2',
                subscriptionId: 's-2',
                status: 'ACTIVE',
                lines: [],
                specialTerms: true,
            },
        ],
        skipped: [{ tenantId: 't3', subscriptionId: 's-3', reason: 'ends-before' }],
        targets: [PRO],
        blockers,
    };
}

/** Mounts the dialog on a flow of its own, and hands the flow back to drive it. */
async function mountWithdrawDialog(preview: unknown) {
    let flow: FeatureWithdrawalAnnouncementFlow | undefined;
    const Host = defineComponent({
        setup() {
            const own = useFeatureWithdrawalAnnouncement({
                withdrawals: {
                    preview: async () => preview as never,
                    announce: async () => ({ withdrawal: {}, told: 0, failed: 0 }) as never,
                },
                catalog: {
                    features: async () =>
                        [{ featureKey: 'EXPORT', label: 'Data export', deletedAt: null }] as never,
                },
                mfa: { run: async () => ({ done: false }) },
                onAnnounced: async () => {},
            });
            flow = own;
            return () => h(FeatureWithdrawDialog, { flow: own });
        },
    });
    const wrapper = mountWithQuasar(Host as never, { attachTo: document.body });
    mounted.push(wrapper);
    await flow!.open();
    await flow!.chooseFeature('EXPORT');
    flow!.setReason('The export service has been switched off.');
    await settle();
    return flow!;
}

const withdrawButton = () =>
    [...document.querySelectorAll('button')].find((b) =>
        /^(Withdraw|Zurückziehen)$/.test(b.textContent?.trim() ?? ''),
    );

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('withdrawing in the dialog', () => {
    test('says whom it reaches, who holds it only by special terms, and who ends before', async () => {
        await mountWithdrawDialog(previewOf());
        const text = document.body.textContent ?? '';
        expect(text).toMatch(/Reaches 2 subscriptions|Erreicht 2 Abonnements/);
        expect(text).toMatch(
            /1 of them hold the feature through special terms only|1 davon haben das Feature nur über Sonderkonditionen/,
        );
        expect(text).toMatch(
            /1 subscriptions end before the date|1 Abonnements enden vor dem Datum/,
        );
    });

    test('asks a reduction per plan in its rhythm, and says which amount it cannot send', async () => {
        const flow = await mountWithdrawDialog(previewOf());
        const text = document.body.textContent ?? '';
        expect(text).toMatch(/Pro \(PRO\), (Monthly|Monatlich)/);
        expect(text).toMatch(/2 lines, lowest price|2 Zeilen, niedrigster Preis/);
        expect(withdrawButton()?.hasAttribute('disabled')).toBe(false);

        flow.setAmount(featureWithdrawalTargetKeyOf(PRO as never), 50);
        await settle();
        expect(document.body.textContent).toMatch(
            /At most .*49.*the lowest price|Höchstens .*49.*der niedrigste Preis/,
        );
        expect(withdrawButton()?.hasAttribute('disabled')).toBe(true);
    });

    test('a blocker is said in the operator’s words, with its date as they read one, and refuses the button', async () => {
        await mountWithdrawDialog(
            previewOf([
                {
                    code: 'FEATURE_WITHDRAWAL_OVERLAPS',
                    message: 'EXPORT is withdrawn until 2026-08-01.',
                    params: { featureKey: 'EXPORT', date: '2026-08-01' },
                },
            ]),
        );
        const text = document.body.textContent ?? '';
        expect(text).toMatch(
            /EXPORT (is withdrawn until|ist bis zum) 0?1[./]0?8[./]2026|EXPORT is withdrawn until 08\/01\/2026/,
        );
        expect(text).not.toContain('2026-08-01');
        expect(withdrawButton()?.hasAttribute('disabled')).toBe(true);
    });
});
