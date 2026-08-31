// @requirement SC-A11Y-006 — Information is never carried by colour alone
// @requirement SC-UI-005 — A failure appears where the person was looking

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';

import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

// A field that is wrong may not be painted like a field that is fine.
//
// Quasar puts THREE classes on a focused invalid field — `q-field--focused`,
// `q-field--error` and `q-field--highlighted` — and its only label-colour rule
// is keyed on the last of them:
// `.q-field--highlighted .q-field__label { color: currentColor }`. The colour
// inherited that way comes from the control, which Quasar paints `--q-primary`
// and then overrides with `text-negative` while the field is invalid.
//
// So the theme's accent-label rule, keyed on that same `--highlighted`, silently
// took the error case with it: the login, setup and confirmation forms showed a
// failed field with a perfectly normal accent label while its border, icon and
// message stayed red. The `!important` on `.text-negative` is no defence,
// because it sits on the control and the theme rule names the label.
//
// jsdom does not resolve `var()`, so these assert the DECLARED value rather than
// an rgb triple — which is exactly the discriminator here, the two candidate
// colours being two different custom properties.

const QUASAR_CSS = 'node_modules/quasar/dist/quasar.css';
const THEME_CSS = 'src/ui/theme/components/field.css';

const ACCENT = 'var(--sa-color-accent-strong)';
const NEGATIVE = 'var(--q-negative)';

/** The theme rule under test, judged against the stylesheet it has to outrank. */
function loadStylesheets(): CSSStyleSheet {
    const sheets = [QUASAR_CSS, THEME_CSS].map((path) => {
        const element = document.createElement('style');
        element.textContent = readFileSync(resolve(process.cwd(), path), 'utf8');
        document.head.appendChild(element);
        return element.sheet as CSSStyleSheet;
    });
    return sheets[0]!;
}

function mountField(attrs: string) {
    return mountWithQuasar(
        { template: `<div class="sa-page"><q-input label="Name" model-value="" ${attrs} /></div>` },
        { attachTo: document.body },
    );
}

const labelColorOf = (wrapper: ReturnType<typeof mountField>) =>
    getComputedStyle(wrapper.find('.q-field__label').element as HTMLElement).color;

const classesOf = (wrapper: ReturnType<typeof mountField>) =>
    wrapper.find('.q-field').attributes('class') ?? '';

/**
 * Focus the way Quasar listens for it.
 *
 * A `focus` event is not enough: `use-field.js` flips its `focused` state from a
 * `focusin` handler, and without that the field never carries
 * `q-field--focused` and the case would prove nothing.
 */
async function focus(wrapper: ReturnType<typeof mountField>) {
    await wrapper.find('input').trigger('focusin');
    await new Promise((tick) => setTimeout(tick, 0));
}

describe('the accent label yields to the error state', () => {
    let quasarSheet: CSSStyleSheet;

    beforeAll(() => {
        quasarSheet = loadStylesheets();
    });

    test('the stylesheet the theme has to outrank really parsed', () => {
        // Every case below is an equality against one of two custom properties,
        // and both would read as `rgb(0, 0, 0)` if no stylesheet had loaded.
        expect(quasarSheet.cssRules.length, 'quasar.css did not parse').toBeGreaterThan(1000);
    });

    test('a focused valid field still gets the accent label', async () => {
        // The other half of the guard: without this case, deleting the theme
        // rule outright would make every remaining one pass.
        const wrapper = mountField('');
        await focus(wrapper);

        expect(classesOf(wrapper)).toContain('q-field--focused');
        expect(classesOf(wrapper)).not.toContain('q-field--error');
        expect(labelColorOf(wrapper)).toBe(ACCENT);
        wrapper.unmount();
    });

    test('a focused invalid field keeps its negative label', async () => {
        const wrapper = mountField(':error="true" error-message="bad"');
        await focus(wrapper);

        // The condition of the finding: all three states at once.
        expect(classesOf(wrapper)).toContain('q-field--focused');
        expect(classesOf(wrapper)).toContain('q-field--error');
        expect(classesOf(wrapper)).toContain('q-field--highlighted');

        expect(
            labelColorOf(wrapper),
            'an invalid field names itself in the accent colour while the rest of it is red',
        ).not.toBe(ACCENT);
        expect(labelColorOf(wrapper)).toBe(NEGATIVE);
        wrapper.unmount();
    });

    test('an invalid field that was never focused keeps it too', () => {
        // Quasar sets `q-field--highlighted` on `hasError || focused`, so the
        // theme rule reached every invalid field, not only the focused one —
        // the review found the narrower half.
        const wrapper = mountField(':error="true" error-message="bad"');

        expect(classesOf(wrapper)).not.toContain('q-field--focused');
        expect(classesOf(wrapper)).toContain('q-field--highlighted');
        expect(labelColorOf(wrapper)).toBe(NEGATIVE);
        wrapper.unmount();
    });

    test('a list item has no error state for the sibling rule to trample', () => {
        // The sibling rule in the same sheet paints `q-item--active` and
        // `q-manual-focusable--focused` with the accent and needs no such
        // carve-out, because Quasar gives an item no failed state to lose. This
        // pins that: the day a `q-item--error` appears, the item rule has the
        // hole this file was written for.
        //
        // The other half — an item a page deliberately paints red — is safe for
        // a reason jsdom cannot show: `.text-negative` lands on the item ITSELF,
        // so its `!important` outranks the theme, whereas an invalid field's red
        // sits on the control and only reaches the label by inheritance. jsdom's
        // cssstyle drops the `!important` flag from any declaration whose value
        // is a `var()`, so asserting that here would only measure jsdom.
        const wrapper = mountWithQuasar(
            {
                // No `disable`: it switches off the clickable branch, and with
                // it the focus modifier the item rule is keyed on.
                template: `<div class="sa-portal"><q-list><q-item active clickable manual-focus focused dense dark>Delete</q-item></q-list></div>`,
            },
            { attachTo: document.body },
        );

        const classes = wrapper.find('.q-item').attributes('class') ?? '';
        expect(classes).toContain('q-item--active');
        expect(classes).toContain('q-manual-focusable--focused');
        expect(classes).not.toMatch(/error|invalid/);
        wrapper.unmount();
    });
});
