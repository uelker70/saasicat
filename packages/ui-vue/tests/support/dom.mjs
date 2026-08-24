// A DOM for the `node --test` suite.
//
// This suite was deliberately DOM-free, and the reason it gave was "we don't
// want to provide one here without a jsdom dependency" — written before the
// component runner brought jsdom into the package. The reason has expired; the
// preference behind it has not, so this stays small and explicit rather than
// becoming a global setup file every test pays for.
//
// What it buys is not only coverage. The component runner imports from `src/`,
// so nothing tested whether these composables survive the bundle. Here they are
// imported from `dist/` like every other unit in this suite — which is the
// artifact a consumer loads.

import { JSDOM } from 'jsdom';

/**
 * Installs a document on the globals Vue reads, and hands it back.
 *
 * Returned as well as installed, so a test names where its `document` came
 * from instead of reaching for an ambient global that only exists because this
 * ran first. That is also why the lint config needs no browser-globals
 * exception for this suite: nothing here reads one.
 *
 * The globals are the ones `@vue/runtime-dom` and `@vue/test-utils` touch
 * during a mount. Assigned rather than merged wholesale: copying every jsdom
 * global over Node's own replaces `URL`, `TextEncoder` and friends with
 * jsdom's, and the difference surfaces later as a value that fails an
 * `instanceof` in code nobody was testing.
 */
export function installDom() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/',
        pretendToBeVisual: true,
    });

    const provided = {
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        HTMLElement: dom.window.HTMLElement,
        Element: dom.window.Element,
        Node: dom.window.Node,
        Event: dom.window.Event,
        KeyboardEvent: dom.window.KeyboardEvent,
        MouseEvent: dom.window.MouseEvent,
        CustomEvent: dom.window.CustomEvent,
        SVGElement: dom.window.SVGElement,
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        // vue-router reaches for these even under `createMemoryHistory`: its
        // `finalizeNavigation` touches `history` unconditionally, and without
        // it a routed component throws `ReferenceError` from inside the router
        // rather than from anything the test wrote.
        history: dom.window.history,
        location: dom.window.location,
        requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
        cancelAnimationFrame: (handle) => clearTimeout(handle),
    };

    const previous = new Map();
    for (const [name, value] of Object.entries(provided)) {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }

    return {
        window: dom.window,
        document: dom.window.document,
        KeyboardEvent: dom.window.KeyboardEvent,
        teardown() {
            for (const [name, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else delete globalThis[name];
            }
            dom.window.close();
        },
    };
}
