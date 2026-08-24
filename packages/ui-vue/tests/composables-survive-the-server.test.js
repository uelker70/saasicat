// The composables render on a server, where there is no document.
//
// A consumer embedding the tenant components may be running Nuxt, and an
// initially-open dialog is the case that reaches the DOM before the first
// `await`: `useDialog`'s immediate watcher engaged straight into
// `document.activeElement`, which on a server is a `ReferenceError` inside a
// component the consumer did not write.
//
// Deliberately in its OWN file with no `installDom()`: the other two suites
// plant a document at module load, so a guard tested beside them would be
// tested against the very thing it exists to do without. `node --test` gives
// each file its own process, which is what makes that separation real.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

import { useDialog, useSteps } from '../dist/index.js';

test('the premise holds: there is no document here', () => {
    // Without this the assertions below pass for the wrong reason on any day
    // somebody adds a global setup file to this suite.
    assert.equal(typeof document, 'undefined');
});

describe('an initially-open dialog renders on the server', () => {
    const Host = defineComponent({
        setup() {
            const dialog = useDialog({ open: () => true, onClose: () => {} });
            return { dialog };
        },
        render() {
            return h('div', { ...this.dialog.backdropProps }, [
                h('div', { ref: this.dialog.panelRef, ...this.dialog.panelProps }, [
                    h('h2', { id: this.dialog.titleId }, 'Change plan'),
                ]),
            ]);
        },
    });

    test('it does not reach for a document that is not there', async () => {
        const html = await renderToString(createSSRApp(Host));
        assert.match(html, /aria-modal="true"/);
        assert.match(html, /Change plan/);
    });

    test('the markup it emits is still named', async () => {
        // The ARIA half is not DOM work and must survive the server, or the
        // first painted frame after hydration is an unnamed dialog.
        const html = await renderToString(createSSRApp(Host));
        assert.match(html, /role="dialog"/);
        assert.match(html, /aria-labelledby="[^"]+"/);
    });
});

describe('a wizard renders on the server', () => {
    test('the step machine needs no document to say where it is', async () => {
        const Host = defineComponent({
            setup() {
                const steps = useSteps({ steps: ['choose', 'preview'] });
                return { steps };
            },
            render() {
                return h('h3', { ref: this.steps.headingRef, ...this.steps.headingProps }, [
                    `step: ${this.steps.current.value}`,
                    ` (${this.steps.statusOf('preview')})`,
                ]);
            },
        });

        const html = await renderToString(createSSRApp(Host));
        assert.match(html, /step: choose/);
        assert.match(html, /\(upcoming\)/);
    });
});
