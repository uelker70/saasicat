// Driving a mounted page's dialogs the way the operator does: the dialog on
// screen, a field typed into, and the second factor's prompt answered.

import { expect } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';

/** Lets the page's loads and the dialogs' transitions finish. */
export async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
}

/** The dialog on screen, and its confirming button. */
export function dialog() {
    const node = [...document.querySelectorAll<HTMLElement>('.sa-dialog')].at(-1);
    const buttons = node?.querySelectorAll<HTMLButtonElement>('.sa-dialog__actions button');
    return { node, submit: buttons?.[1] };
}

/** The field of the dialog labelled `label`. */
export function fieldOf(label: string): HTMLInputElement {
    const field = [...(dialog().node?.querySelectorAll('.sa-field') ?? [])].find((candidate) =>
        candidate.textContent?.includes(label),
    );
    const input = field?.querySelector<HTMLInputElement>('input, textarea');
    if (!input) throw new Error(`no field ${label}`);
    return input;
}

/** Types `value` into the field of the dialog labelled `label`. */
export async function typeInto(label: string, value: string): Promise<void> {
    const input = fieldOf(label);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await nextTick();
}

/** Answers the second factor's prompt with `code`, as the operator does. */
export async function enterTheCode(code: string): Promise<void> {
    await settle();
    const card = document.querySelector<HTMLElement>('.mfa-card');
    expect(card, 'the second factor was not asked for').toBeTruthy();
    const input = card?.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('the second factor has no field');
    input.value = code;
    input.dispatchEvent(new Event('input'));
    await nextTick();
    [...(card?.querySelectorAll<HTMLButtonElement>('button') ?? [])].at(-1)?.click();
    await settle();
}
