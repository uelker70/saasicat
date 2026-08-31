// The plans page renders its own chrome, or the step does — never both.
//
// The editor and the review became child routes in 4.11, and the condition that
// decides this kept asking a `mode` ref that nothing assigns any more. It was
// therefore false on both step routes: the page drew its hero and its body
// while `<router-view>` drew the step underneath, putting two complete plan
// views on one screen with two `<h1>`s.
//
// A structural test cannot see that. What the page renders depends on the route
// it is mounted under, so this mounts it under one and looks.

// @requirement SC-UI-002 — Mounting a shipped screen costs no wiring

import { describe, expect, test } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { standardAdminChildren } from '../../src/pages/index.js';
import { PLAN_STEP_META } from '../../src/features/plan/plan-area-context.js';

describe('the route table marks the plan steps as steps', () => {
    // The page reads this to know it should stand aside. Asserted on the built
    // records rather than on the literal table, because `standardAdminChildren`
    // is what a consumer calls and what therefore has to carry it.
    const built = standardAdminChildren();
    const plans = built.find((route) => route.path === 'plans');

    test('the plans route has the two steps as children', () => {
        expect(plans, 'the plans route disappeared from the table').toBeTruthy();
        expect(plans?.children?.map((child) => child.path)).toEqual([
            'version/edit',
            'version/review',
        ]);
    });

    test('every nested standard route carries the step marker', () => {
        // Derived: whatever the table nests is a step, so the expectation is
        // "all of them" rather than a list of two paths repeated here.
        const nested = built.flatMap((route) => route.children ?? []);
        expect(nested.length, 'no nested routes — this would pass on nothing').toBeGreaterThan(0);
        for (const child of nested) {
            expect(child.meta?.[PLAN_STEP_META], `${child.path} is not marked`).toBe(true);
        }
    });

    test('a claimed plans route keeps the steps beneath it', () => {
        // Wrapping `PlansPage` is the documented override. The wrapper still
        // navigates to `version/edit`; with the steps dropped the router fell
        // through to the catch-all and the editor never mounted.
        const Wrapper = { template: '<router-view />' };
        const own = standardAdminChildren([{ path: 'plans', component: Wrapper }]);
        const claimed = own.find((route) => route.path === 'plans');
        expect(claimed?.component).toBe(Wrapper);
        expect(claimed?.children?.map((child) => child.path)).toEqual([
            'version/edit',
            'version/review',
        ]);
        expect(claimed?.children?.every((child) => child.meta?.[PLAN_STEP_META] === true)).toBe(
            true,
        );
        expect(own.filter((route) => route.path === 'plans')).toHaveLength(1);
    });

    test('an own children list on a claimed route wins outright', () => {
        const Own = { template: '<div />' };
        const own = standardAdminChildren([
            { path: 'plans', component: Own, children: [{ path: 'mine', component: Own }] },
        ]);
        expect(own.find((route) => route.path === 'plans')?.children?.map((c) => c.path)).toEqual([
            'mine',
        ]);
    });

    test('a top-level standard route is not marked', () => {
        // The counter-check: if everything were marked, the page would never
        // draw its own hero and the test above would still pass.
        const marked = built.filter((route) => route.meta?.[PLAN_STEP_META] === true);
        expect(marked).toEqual([]);
    });
});

describe('the condition the page reads answers per route', () => {
    // The predicate itself, driven against the real records. `resolve()` rather
    // than `push()`: navigating loads every matched page component, which is a
    // second's work per route and answers a question nobody asked here. What is
    // in question is which records a path matches.
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/admin',
                component: { template: '<router-view />' },
                children: standardAdminChildren(),
            },
        ],
    });

    const viewOwnsHero = (path: string) =>
        router.resolve(path).matched.some((record) => record.meta?.[PLAN_STEP_META] === true);

    test('the paths resolve at all', () => {
        // Without this a typo makes every case below answer `false` for the
        // same reason and two of them pass by accident.
        for (const path of [
            '/admin/plans',
            '/admin/plans/version/edit',
            '/admin/plans/version/review',
            '/admin/tenants',
        ]) {
            expect(router.resolve(path).matched.length, `${path} matched nothing`).toBeGreaterThan(
                0,
            );
        }
    });

    test('on the plans route itself the page owns the hero', () => {
        expect(viewOwnsHero('/admin/plans')).toBe(false);
    });

    test('on the editor step the page stands aside', () => {
        expect(viewOwnsHero('/admin/plans/version/edit')).toBe(true);
    });

    test('on the review step the page stands aside', () => {
        expect(viewOwnsHero('/admin/plans/version/review')).toBe(true);
    });

    test('and on a sibling page it owns the hero again', () => {
        expect(viewOwnsHero('/admin/tenants')).toBe(false);
    });
});
