// A resource registry for a mounted page, without a server.
//
// Every page migrated onto the resource idiom asks the registry for its data,
// so a fixture that mounts one has to provide a registry or the page throws at
// setup. Stubbing the operations is also what makes the assertions readable:
// the test says what the server returns, not which URL was called.
//
// Deliberately not `createResourceRegistry` with a fake `http`: that would put
// URL construction and query-string encoding inside every page test, and those
// belong to `tests/resource-registry.test.js`, which tests them once against
// the real descriptors.

import { SUPER_ADMIN_RESOURCES_KEY } from '../../../src/vue/resource-registry';

/** Operations by resource key, as a page will call them. */
export type ResourceStubs = Record<string, Record<string, (...args: never[]) => unknown>>;

/**
 * A `global.provide` entry that answers `useResource(key)` from `stubs`.
 *
 * An unstubbed key throws with the key in the message rather than returning an
 * empty object, because a page reading `undefined.list` fails several frames
 * later with nothing pointing back at the fixture.
 */
export function provideStubResources(stubs: ResourceStubs): Record<symbol, unknown> {
    const registry = {
        get(key: string) {
            const ops = stubs[key];
            if (!ops) {
                throw new Error(
                    `test fixture: no stub for resource "${key}". Stubbed: ` +
                        `${Object.keys(stubs).join(', ') || '(none)'}.`,
                );
            }
            return ops;
        },
        // A page passing its own `resources` prop reaches this. The stub is
        // already whatever the test wants, so the override is ignored — but the
        // layering itself is covered by tests/resource-registry.test.js.
        bind(key: string) {
            return registry.get(key);
        },
        keys: () => Object.keys(stubs),
    };
    return { [SUPER_ADMIN_RESOURCES_KEY as symbol]: registry };
}
