// The confirm port: how a request reaches Quasar, and how an app replaces it.
//
// This is the first test of a UI port in this package — the notify port next
// door has none — so it checks the two things a port can get wrong. One is the
// mapping: a request has to arrive as the dialog the page asked for, including
// the colour that marks an action as destructive. The other is resolution: an
// app that provides its own implementation must actually be the one asked, or
// the port is decoration.

import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

import {
    SUPER_ADMIN_CONFIRM_KEY,
    type UiConfirm,
    type UiConfirmRequest,
    type UiConfirmResult,
} from '../src/vue/ui-confirm.js';
import {
    quasarConfirm,
    quasarConfirmOptions,
    useSuperAdminConfirm,
} from '../src/quasar/confirm.js';

const DELETE_REQUEST: UiConfirmRequest = {
    title: 'Delete API key "Production Integration"?',
    message: 'This cannot be undone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    tone: 'negative',
};

/** Mounts a component that resolves the port and reports what it got. */
function resolvePort(provided?: UiConfirm): UiConfirm {
    let resolved: UiConfirm | undefined;
    const Probe = defineComponent({
        setup() {
            resolved = useSuperAdminConfirm();
            return () => h('div');
        },
    });
    mount(
        Probe,
        provided ? { global: { provide: { [SUPER_ADMIN_CONFIRM_KEY as symbol]: provided } } } : {},
    );
    return resolved as UiConfirm;
}

describe('quasarConfirmOptions', () => {
    test('carries the wording the page wrote, not a generic "are you sure"', () => {
        const options = quasarConfirmOptions(DELETE_REQUEST);
        expect(options.title).toBe('Delete API key "Production Integration"?');
        expect(options.message).toBe('This cannot be undone.');
    });

    test('a destructive action is coloured as one', () => {
        expect(quasarConfirmOptions(DELETE_REQUEST).ok).toEqual({
            label: 'Delete',
            color: 'negative',
        });
    });

    test('tone defaults to primary — only the caller may call something destructive', () => {
        const options = quasarConfirmOptions({ ...DELETE_REQUEST, tone: undefined });
        expect(options.ok).toEqual({ label: 'Delete', color: 'primary' });
    });

    test('both buttons are labelled, so neither reads "OK"', () => {
        const options = quasarConfirmOptions(DELETE_REQUEST);
        expect(options.cancel).toBe('Cancel');
        expect((options.ok as { label: string }).label).toBe('Delete');
    });

    test('no prompt means no input — a plain confirm stays plain', () => {
        expect(quasarConfirmOptions(DELETE_REQUEST).prompt).toBeUndefined();
    });

    test('a prompt carries its initial value and type', () => {
        const options = quasarConfirmOptions({
            ...DELETE_REQUEST,
            prompt: { initial: '2026-09-30', type: 'date' },
        });
        expect(options.prompt).toEqual({ model: '2026-09-30', type: 'date' });
    });

    test('a prompt with no initial value starts empty and takes text', () => {
        const options = quasarConfirmOptions({ ...DELETE_REQUEST, prompt: {} });
        expect(options.prompt).toEqual({ model: '', type: 'text' });
    });
});

describe('useSuperAdminConfirm', () => {
    test('an app-provided port is the one that gets asked', async () => {
        const asked: UiConfirmRequest[] = [];
        const appPort: UiConfirm = async (request): Promise<UiConfirmResult> => {
            asked.push(request);
            return { ok: true, value: 'because audit' };
        };

        const confirm = resolvePort(appPort);
        const result = await confirm(DELETE_REQUEST);

        expect(asked).toHaveLength(1);
        expect(asked[0].title).toBe(DELETE_REQUEST.title);
        expect(result).toEqual({ ok: true, value: 'because audit' });
    });

    test('without one, the Quasar implementation is the fallback — which still asks', () => {
        expect(resolvePort()).toBe(quasarConfirm);
    });

    test('a context from an older package version still resolves, because the key is Symbol.for', () => {
        // A consumer holding a second copy of the module — dist alongside src —
        // recreates the key rather than importing this one. `Symbol.for` makes
        // the two the same symbol; a bare `Symbol()` would miss.
        const olderCopyKey = Symbol.for('saasicat/ui-vue/SUPER_ADMIN_CONFIRM');
        expect(olderCopyKey).toBe(SUPER_ADMIN_CONFIRM_KEY);
    });
});
