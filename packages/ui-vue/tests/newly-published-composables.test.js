// The four modules the export barrels started publishing in 1.0.
//
// They were reachable only from inside the package until the component build
// needed every deep import rewritable to a public specifier — 360 of 360 names,
// and these four were the six that were not there. Publishing them was the
// right call for three of them anyway (a layer publishes its composables) and
// overdue for the fourth: `CONTRIBUTING.md` has told contributors to use
// `attachCause()` since the ES2021 floor was written.
//
// Tested here rather than only through a mounted page. The component runner
// exercises them from `src/` inside a page and asserts what the page does; this
// asserts what the composable promises, against `dist/` — the bundle a consumer
// loads, where a barrel that forgot to re-export one of them looks exactly like
// a barrel that never had it.

// @requirement SC-PLAN-011 — A published version says which day it applies from

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './support/dom.mjs';

const { teardown: teardownDom } = installDom();
const { mount } = await import('@vue/test-utils');
const { defineComponent, h } = await import('vue');
const { createRouter, createMemoryHistory } = await import('vue-router');
const {
    attachCause,
    useMfaPrompt,
    providePlanWizard,
    usePlanWizard,
    useSignOut,
    DEFAULT_LOGIN_PATH,
    SUPER_ADMIN_LOGIN_ADAPTER_KEY,
    SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY,
} = await import('../dist/index.js');

after(teardownDom);

/** Runs a composable inside a mounted component and hands back what it returned. */
function inSetup(run) {
    let result;
    const wrapper = mount(
        defineComponent({
            setup() {
                result = run();
                return () => h('div');
            },
        }),
    );
    return { result, wrapper };
}

describe('the barrels publish all four', () => {
    test('every one of them arrived', () => {
        // The cheap half, and the one that catches a barrel edited by hand:
        // a missing re-export is `undefined` at the call site, which reads as
        // "not a function" somewhere far away.
        for (const [name, value] of Object.entries({
            attachCause,
            useMfaPrompt,
            providePlanWizard,
            usePlanWizard,
            useSignOut,
        })) {
            assert.equal(typeof value, 'function', `${name} is not published by dist/index.js`);
        }
    });
});

describe('attachCause', () => {
    test('it attaches a cause without the ES2022 constructor option', () => {
        const error = attachCause(new Error('outer'), new Error('inner'));
        assert.equal(error.cause.message, 'inner');
    });

    test('it returns the same error rather than a copy', () => {
        // Callers write `throw attachCause(new AdminError(…), err)`, so a copy
        // would silently drop whichever subclass fields they had just set.
        const original = new TypeError('outer');
        assert.equal(attachCause(original, 'why'), original);
    });

    test('the property stays writable, the way the native one is', () => {
        const error = attachCause(new Error('outer'), 'first');
        error.cause = 'second';
        assert.equal(error.cause, 'second');
    });
});

describe('useMfaPrompt', () => {
    test('a prompt opens the dialog and waits', async () => {
        const { result: mfa } = inSetup(() => useMfaPrompt());
        const answer = mfa.prompt('Confirm the deletion');

        assert.equal(mfa.show.value, true);
        assert.equal(mfa.description.value, 'Confirm the deletion');

        mfa.onConfirm('123456');
        assert.equal(await answer, '123456');
    });

    test('a second prompt settles the first instead of stranding it', async () => {
        // The pending resolve is a single slot. Overwriting it would leave the
        // first caller awaiting a promise nothing can ever settle.
        const { result: mfa } = inSetup(() => useMfaPrompt());
        const first = mfa.prompt('one');
        const second = mfa.prompt('two');

        assert.equal(await first, null);
        mfa.onConfirm('000000');
        assert.equal(await second, '000000');
    });

    test('closing answers the caller with null', async () => {
        const { result: mfa } = inSetup(() => useMfaPrompt());
        const answer = mfa.prompt('one');
        mfa.close();
        assert.equal(await answer, null);
        assert.equal(mfa.show.value, false);
    });
});

describe('the plan wizard state', () => {
    test('a provided state reaches a descendant', () => {
        let seen;
        const Child = defineComponent({
            setup() {
                seen = usePlanWizard();
                return () => h('span');
            },
        });
        const Parent = defineComponent({
            setup() {
                const state = providePlanWizard();
                state.planKey.value = 'PRO';
                return () => h('div', [h(Child)]);
            },
        });
        mount(Parent);
        assert.equal(seen.planKey.value, 'PRO');
    });

    test('without a provider it hands back a fresh, unshared one', () => {
        // A deep link into the editor means an empty draft, not a crash — and
        // "unshared" is the half that matters: two orphan steps must not write
        // into each other.
        const { result: first } = inSetup(() => usePlanWizard());
        const { result: second } = inSetup(() => usePlanWizard());
        first.planKey.value = 'PRO';
        assert.equal(second.planKey.value, null);
    });

    test('reset empties the draft', () => {
        const { result: state } = inSetup(() => providePlanWizard());
        state.planKey.value = 'PRO';
        state.review.value = { version: 3 };
        state.reset();
        assert.equal(state.planKey.value, null);
        assert.equal(state.review.value, null);
    });
});

describe('useSignOut', () => {
    /**
     * Mounts a component that calls the composable, inside a real router.
     *
     * A real one rather than a stub: `useSignOut` reads it with `useRouter()`,
     * which resolves through the router's own injection key — a hand-made
     * object provided under a guessed key would leave the composable throwing
     * and the test asserting the throw.
     */
    async function signOutWith(provides) {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: { render: () => h('div') } },
                { path: DEFAULT_LOGIN_PATH, component: { render: () => h('div') } },
                { path: '/admin', component: { render: () => h('div') } },
            ],
        });
        await router.push('/admin');
        await router.isReady();

        let signOut;
        mount(
            defineComponent({
                setup() {
                    signOut = useSignOut();
                    return () => h('div');
                },
            }),
            { global: { plugins: [router], provide: provides } },
        );
        return { signOut, router };
    }

    test('it ends the session and then goes to the login page', async () => {
        const calls = [];
        const { signOut, router } = await signOutWith({
            [SUPER_ADMIN_LOGIN_ADAPTER_KEY]: { logout: async () => calls.push('logout') },
        });

        await signOut();
        assert.deepEqual(calls, ['logout']);
        assert.equal(router.currentRoute.value.path, DEFAULT_LOGIN_PATH);
    });

    test('a rejecting logout still leaves the protected page', async () => {
        // Staying would strand the operator on the page they just asked to
        // leave, and the adapter may well have cleared the local token before
        // the request failed.
        const { signOut, router } = await signOutWith({
            [SUPER_ADMIN_LOGIN_ADAPTER_KEY]: {
                logout: async () => {
                    throw new Error('revocation failed');
                },
            },
        });

        await signOut();
        assert.equal(router.currentRoute.value.path, DEFAULT_LOGIN_PATH);
    });

    test('with no adapter it navigates anyway', async () => {
        const { signOut, router } = await signOutWith({});
        await signOut();
        assert.equal(router.currentRoute.value.path, DEFAULT_LOGIN_PATH);
    });

    test('the manifest cache is cleared whether or not an adapter ran', async () => {
        // Unconditionally and after the adapter either way: a stale manifest
        // would otherwise greet the next operator with the previous one's nav.
        const cleared = [];
        const { signOut } = await signOutWith({
            [SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY]: () => cleared.push('cleared'),
        });
        await signOut();
        assert.deepEqual(cleared, ['cleared']);
    });
});
