// A descriptor's `projectScoped` says what its operations do.
//
// `bindResource` refuses a project-scoped resource without a project, and it
// asks the descriptor which ones those are. That declaration is the kind of
// statement that goes stale in silence: adding `?projectKey=` to the tenant
// list would send an empty key again with nothing complaining, and a `true`
// left behind by an operation that stopped reading it would refuse a
// configuration that is fine.
//
// So nothing here lists which resources are project-scoped. Every descriptor
// the package exports is driven through a context that records what it reads,
// and the observation is compared with the declaration in both directions.
//
// What this cannot see: an operation that reads `projectKey` only on a branch
// these arguments do not take. The guard below — every operation must be
// observed reading `apiBase` — proves each one ran far enough to touch its
// context at all, which is the failure that would otherwise make this file
// agree with everything.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import * as pkg from '../dist/index.js';

/** Answers every request, richly enough that no operation bails early. */
function recordingHttp() {
    const urls = [];
    const http = (url) => {
        urls.push(url);
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            json: async () => ({ id: 'x', items: [] }),
            text: async () => '{}',
        });
    };
    return { http, urls };
}

/**
 * Arguments generic enough to get any operation to its URL.
 *
 * The descriptors take `(planId)`, `(planId, data)`, `(versionId, endsAt)`,
 * `(query?)` or — `dashboard.kpi` — a manifest card carrying its own endpoint;
 * what matters is only that the call reaches its request, not that the request
 * would be accepted by a server. The first argument is shaped to serve as both
 * an id and a card, so no operation needs naming here.
 */
const PROBE_ARGS = [
    Object.assign(new String('probe-id'), {
        endpoint: '/probe-endpoint',
        displayHint: { type: 'value' },
    }),
    {},
];

const CTX = { apiBase: '/api/v1/admin', projectKey: 'probe', locale: 'en' };

/** Anything shaped like a resource descriptor, whatever it is exported as. */
function isResourceDef(value) {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof value.key === 'string' &&
        typeof value.projectScoped === 'boolean' &&
        typeof value.ops === 'object' &&
        value.ops !== null
    );
}

/** Every descriptor the package hands out — derived from the module, not listed. */
function exportedResources() {
    const found = new Map();
    for (const value of Object.values(pkg)) {
        if (isResourceDef(value)) found.set(value.key, value);
    }
    for (const value of Object.values(pkg.platformResources ?? {})) {
        if (isResourceDef(value)) found.set(value.key, value);
    }
    return [...found.values()];
}

/**
 * Runs one operation against a context that reports what it was asked for.
 *
 * A `Proxy` rather than getters on a literal, so a property the descriptor
 * never touches is recorded as untouched — which is the whole measurement.
 */
async function readsOf(op) {
    const read = new Set();
    const { http, urls } = recordingHttp();
    const ctx = new Proxy(CTX, {
        get(target, prop, receiver) {
            if (typeof prop === 'string') read.add(prop);
            return Reflect.get(target, prop, receiver);
        },
    });
    try {
        await op(http, ctx, ...PROBE_ARGS);
    } catch {
        // A probe argument the operation does not like is not a finding: the
        // reads happened on the way to the failure, and those are the answer.
    }
    return { read, requested: urls.length > 0 };
}

/** Which operations of a descriptor read the project, and which read anything. */
async function observe(def) {
    const project = [];
    const driven = [];
    for (const [name, op] of Object.entries(def.ops)) {
        const { read, requested } = await readsOf(op);
        if (read.has('projectKey')) project.push(name);
        // Reaching the context OR reaching the client both prove the operation
        // ran far enough for the reads above to mean something. The context
        // alone used to be the proof, which held until `dashboard.kpi` built
        // its URL from the manifest card it was handed and touched no context
        // at all — an operation the old question had to call unmeasured while
        // it was in fact the easiest of them to measure.
        if (read.has('apiBase') || requested) driven.push(name);
    }
    return { project, driven };
}

const RESOURCES = exportedResources();

describe('every descriptor declares the project scope its operations have', () => {
    test('there are descriptors to measure at all', () => {
        // Without this the whole file passes by finding nothing — the shape of
        // green that says least.
        assert.ok(RESOURCES.length > 0, 'no resource descriptors were exported');
    });

    for (const def of RESOURCES) {
        test(`${def.key}: projectScoped === ${def.projectScoped}`, async () => {
            const { project, driven } = await observe(def);
            const ops = Object.keys(def.ops);

            // The probe has to prove it drove them, or "reads nothing" below
            // would be indistinguishable from "was never really called".
            assert.deepEqual(
                driven.sort(),
                ops.sort(),
                `${def.key}: these operations neither read the context nor issued a request, ` +
                    `so nothing was measured about them: ` +
                    `${ops.filter((o) => !driven.includes(o)).join(', ')}`,
            );

            if (def.projectScoped) {
                assert.ok(
                    project.length > 0,
                    `${def.key} declares projectScoped: true, but no operation reads ` +
                        'ctx.projectKey — binding it would refuse a configuration that is fine',
                );
            } else {
                assert.deepEqual(
                    project,
                    [],
                    `${def.key} reads ctx.projectKey in ${project.join(', ')} but does not ` +
                        'declare projectScoped: true — an empty project key would go out as ' +
                        '`?projectKey=` with nothing refusing it',
                );
            }
        });
    }
});

describe('why the check is per descriptor and not per registry', () => {
    test('some resources read the project and others never do', async () => {
        // The measurement the seam was chosen on. If every resource were
        // project-scoped, one demand made once at the registry would be the
        // simpler answer; if none were, the declaration would be dead weight.
        // Asserting the split rather than a roster keeps this true as the
        // roster grows.
        const scoped = [];
        const unscoped = [];
        for (const def of RESOURCES) {
            const { project } = await observe(def);
            (project.length > 0 ? scoped : unscoped).push(def.key);
        }
        assert.ok(scoped.length > 0, 'no resource reads ctx.projectKey — the declaration is dead');
        assert.ok(
            unscoped.length > 0,
            `every resource reads ctx.projectKey (${scoped.join(', ')}) — one demand at the ` +
                'registry would be simpler than a declaration per descriptor',
        );
    });
});

describe('when the project key is asked for', () => {
    test('an unscoped resource does not make the context exist at binding', async () => {
        // The public contract says the context is read when an operation runs.
        // A registry of unscoped resources whose context is built lazily — or
        // whose getter has observable work — must not be made to produce one
        // during construction just so a check that does not apply can run.
        let reads = 0;
        const readContext = () => {
            reads += 1;
            return { ...CTX, projectKey: '' };
        };
        const audit = pkg.bindResource(
            pkg.platformResources.audit,
            recordingHttp().http,
            readContext,
        );
        assert.equal(reads, 0, 'binding an unscoped resource read the context');
        await audit.list({});
        assert.equal(reads, 1, 'the operation did not read the context');
    });

    test('a key that disappears after binding is caught before the request', async () => {
        // The context is read per call by design — a shell that re-scopes or
        // clears a project selection changes it under a binding that was valid.
        // Checking only at boot would send `?projectKey=` after all, which is
        // the request this whole check exists to prevent.
        let projectKey = 'probe';
        const plans = pkg.bindResource(pkg.platformResources.plans, recordingHttp().http, () => ({
            ...CTX,
            projectKey,
        }));
        await plans.list();

        projectKey = '';
        await assert.rejects(() => plans.list(), /project-scoped/);
        await assert.rejects(() => plans.create({ key: 'p', name: 'P' }), /project-scoped/);
    });
});
