// The operator corrects its own details, and the running contracts follow.
//
// `config/saas.yaml` names the legal entity on the operator's side of every
// contract. Its address is a detail and moves freely; its legal name and tax
// identifiers are the party a contract names, and a contract keeps the copy it
// was concluded with for ever. So a start that finds them different from the
// ones this installation recorded continues only where the file says the change
// is a correction of that same entity — and refuses otherwise, because moving a
// contract to another legal entity is a transfer and not an edit of a setting.
//
// These boot real applications: `app.init()` is what runs the check, and what
// makes the order it depends on observable — the record must still hold the
// PREVIOUS start's values when the comparison happens, and the recorder that
// replaces it is a later hook.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
    AppliedSettingsRecorder,
    fingerprintOf,
    IssuerIdentityCheck,
    IssuerIdentityInspector,
} from '../dist/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import {
    FakeSubscriptionContractRepository,
    FakeSubscriberRepository,
} from '../dist/testing/index.js';
import { FakeAppliedSettingsPort } from './helpers/applied-settings-port.js';

// Off the sibling package's directory, the way the codegen reads it: the block
// the refusal prints is held to what the schema declares, not to a second list.
const planCatalogSchema = JSON.parse(
    readFileSync(new URL('../../spec/schemas/plan-catalog.schema.json', import.meta.url), 'utf8'),
);

const NOTICE = { monthly: 14, yearly: 90 };
const BLOCKED = { asTarget: ['ENTERPRISE'], asSource: [] };

const GMBH = {
    legalName: 'Example Software GmbH',
    addressLine1: 'Werkstraße 5',
    postalCode: '80331',
    city: 'München',
    country: 'DE',
    vatId: 'DE123456789',
};

const catalogWith = (issuer) => ({
    schemaVersion: 1,
    app: { name: 'TestApp' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: { cancellationNoticeDays: NOTICE, selfServiceBlockedPlans: BLOCKED },
    ...(issuer ? { issuer } : {}),
    plans: [{ id: 'PRO', name: 'Pro', monthlyNet: 9, yearlyNet: 90, features: [], quotas: {} }],
});

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

const spec = {};

/**
 * The bypass frame, as an adapter without row-level security implements it:
 * it calls through. Real here rather than a placeholder, because the check
 * reads the contracts platform-wide and goes through this to do it.
 */
const passThroughBypass = { runWithBypass: (fn) => fn() };

function persistenceWith(appliedSettings, contracts, bypass = passThroughBypass) {
    return {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: false,
            advisoryLocks: false,
        },
        core: {
            mfa: spec,
            audit: spec,
            rlsBypass: bypass,
            transactionRunner: spec,
            ...(appliedSettings ? { appliedSettings } : {}),
        },
        ...(contracts
            ? {
                  entitlement: {
                      subscriptionContractRepository: contracts,
                      subscriberRepository: new FakeSubscriberRepository(),
                  },
              }
            : {}),
    };
}

/** Composed the way a consumer composes it, and started — `init` runs the check. */
async function boot(catalog, { port, contracts, bypass } = {}) {
    const app = await Test.createTestingModule({
        imports: [
            SaaSiCatModule.forRoot({
                planCatalog: catalog,
                controller: { guards: [FakeJwtGuard] },
                discoverySnapshotPath: null,
                persistence: persistenceWith(port, contracts, bypass),
                defaultPlanId: 'PRO',
                ...(contracts ? { subscriptionContract: true } : {}),
            }),
        ],
    }).compile();
    await app.init();
    return app;
}

/** A port already carrying what a previous start applied. */
function portRecording(settings) {
    const port = new FakeAppliedSettingsPort();
    port.applied = {
        fingerprint: fingerprintOf(settings),
        settings,
        source: 'config/saas.yaml',
        appliedAt: new Date('2026-08-01T06:00:00.000Z'),
    };
    return port;
}

/** The settings tree a start on this catalogue would record. */
function settingsOf(catalog) {
    const { schemaVersion: _v, plans: _p, features: _f, ...settings } = catalog;
    return settings;
}

/**
 * A repository already holding one contract per entry, under `issuerLegalName`
 * — `null` for a party copy that names no issuer. An entry may instead be
 * `{ legalName, endedAt }`, which is how an ordinary cancellation leaves a
 * contract: a window that has closed, and the status left where it was.
 */
function contractsRunning(...entries) {
    const repo = new FakeSubscriptionContractRepository();
    for (const [index, entry] of entries.entries()) {
        const { legalName, endedAt = null } =
            entry === null || typeof entry === 'string' ? { legalName: entry } : entry;
        repo.create({
            tenantId: `tenant-${index + 1}`,
            parties: {
                subscriberId: `subscriber-${index + 1}`,
                subscriber: { customerNumber: `K-1000${index}`, legalName: 'Meier GmbH' },
                issuer: legalName === null ? null : { legalName },
            },
            effectiveFrom: new Date(`2026-0${index + 1}-01T00:00:00.000Z`),
            effectiveUntil: endedAt,
            priceSnapshot: {
                currency: 'EUR',
                billingCycle: 'monthly',
                subtotalNet: 9,
                discountNet: 0,
                totalNet: 9,
                vatRate: 19,
                totalGross: 10.71,
            },
            lineItems: [],
        });
    }
    return repo;
}

/** What `Logger.warn` and `Logger.log` said while `fn` ran. */
async function capturingLogs(fn) {
    const said = { warn: [], log: [] };
    const original = { warn: Logger.prototype.warn, log: Logger.prototype.log };
    Logger.prototype.warn = function (message) {
        said.warn.push(String(message));
    };
    Logger.prototype.log = function (message) {
        said.log.push(String(message));
    };
    try {
        await fn();
    } finally {
        Object.assign(Logger.prototype, original);
    }
    return said;
}

/** The error a refused start dies with. */
async function refusalOf(catalog, wiring) {
    let app;
    try {
        app = await boot(catalog, wiring);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    } finally {
        await app?.close();
    }
    assert.fail('the start was not refused');
}

let app;
afterEach(async () => {
    await app?.close();
    app = undefined;
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('a start that finds the issuer where it left it', () => {
    test('names one for the first time, and says so', async () => {
        const port = new FakeAppliedSettingsPort();
        const said = await capturingLogs(async () => {
            app = await boot(catalogWith(GMBH), { port });
        });
        assert.ok(
            said.log.some((line) => /Example Software GmbH/.test(line)),
            said.log,
        );
        assert.deepEqual(port.applied.settings.issuer, GMBH);
    });

    test('lets the address move without a word from the operator', async () => {
        const moved = { ...GMBH, addressLine1: 'Hauptstraße 1', city: 'Berlin' };
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        app = await boot(catalogWith(moved), { port, contracts: contractsRunning(GMBH.legalName) });
        assert.equal(port.applied.settings.issuer.city, 'Berlin');
        assert.equal(port.changes.length, 1, 'the move is recorded like any other setting');
    });

    // @requirement SC-CFG-025 — The installation records the configuration it applied, and notices when it changed
    test('carries a declared correction through, and keeps the declaration', async () => {
        const corrected = {
            ...GMBH,
            legalName: 'Example Software AG',
            correctionOf: {
                legalName: 'Example Software GmbH',
                reason: 'Change of legal form, registered 2026-07-01',
            },
        };
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const said = await capturingLogs(async () => {
            app = await boot(catalogWith(corrected), {
                port,
                contracts: contractsRunning(GMBH.legalName),
            });
        });
        assert.equal(port.applied.settings.issuer.legalName, 'Example Software AG');
        assert.deepEqual(
            port.changes[0].previous.issuer.legalName,
            'Example Software GmbH',
            'the record keeps both values, and the declaration beside them',
        );
        assert.equal(
            port.changes[0].current.issuer.correctionOf.reason,
            'Change of legal form, registered 2026-07-01',
        );
        assert.ok(
            said.log.some((line) => /registered 2026-07-01/.test(line)),
            said.log,
        );
    });

    test('lets the same declaration stay in the file afterwards', async () => {
        // What the record holds after the start above: the corrected identity,
        // and the declaration that carried it. Starting again on the same file
        // finds nothing moved.
        const corrected = {
            ...GMBH,
            legalName: 'Example Software AG',
            correctionOf: { legalName: 'Example Software GmbH', reason: 'Change of legal form' },
        };
        const port = portRecording(settingsOf(catalogWith(corrected)));
        app = await boot(catalogWith(corrected), {
            port,
            contracts: contractsRunning(GMBH.legalName),
        });
        assert.deepEqual(port.changes, [], 'nothing moved, so nothing was recorded');
    });
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('a start that finds another legal entity', () => {
    test('does not start, and names the contracts still running under the previous one', async () => {
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const contracts = contractsRunning('Example Software GmbH', 'Example Software GmbH');
        const message = await refusalOf(catalogWith({ ...GMBH, legalName: 'Other Software AG' }), {
            port,
            contracts,
        });
        assert.match(message, /not the legal entity this installation recorded/);
        assert.match(message, /'Example Software GmbH'/);
        assert.match(message, /'Other Software AG'/);
        assert.match(message, /2 contract\(s\) are still running/);
        assert.match(message, /tenant tenant-1/);
        assert.match(message, /transfer, not an edit of a setting/);
        assert.match(message, /issuer:\n {4}correctionOf:\n {8}legalName: "Example Software GmbH"/);
    });

    test('leaves the record exactly as the previous start left it', async () => {
        // A refused start writes nothing: the record still says what the last
        // start that got through applied, and the next attempt compares against
        // the same values rather than against a half-applied set.
        const settings = settingsOf(catalogWith(GMBH));
        const port = portRecording(settings);
        await refusalOf(catalogWith({ ...GMBH, legalName: 'Other Software AG' }), {
            port,
            contracts: contractsRunning('Example Software GmbH'),
        });
        assert.deepEqual(port.applied.settings, settings);
        assert.equal(port.applied.appliedAt.toISOString(), '2026-08-01T06:00:00.000Z');
        assert.deepEqual(port.changes, []);
    });

    test('says so even where no contract is running yet', async () => {
        // The same file behaves the same way wherever it is deployed. A rule
        // that let the identity move on an empty database would be one an
        // operator meets for the first time in production, after it passed on
        // staging.
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const message = await refusalOf(catalogWith({ ...GMBH, legalName: 'Other Software AG' }), {
            port,
            contracts: new FakeSubscriptionContractRepository(),
        });
        assert.match(message, /No contract is running\./);
    });

    test('names a declaration that covers another change than this one', async () => {
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const message = await refusalOf(
            catalogWith({
                ...GMBH,
                legalName: 'Other Software AG',
                correctionOf: { legalName: 'Example Software OHG', reason: 'Renamed' },
            }),
            { port, contracts: contractsRunning('Example Software GmbH') },
        );
        assert.match(message, /issuer\.correctionOf\.legalName` names 'Example Software OHG'/);
    });

    test('names a field the declaration says nothing about', async () => {
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const message = await refusalOf(
            catalogWith({
                ...GMBH,
                legalName: 'Example Software AG',
                vatId: 'DE999999999',
                correctionOf: {
                    legalName: 'Example Software GmbH',
                    reason: 'Change of legal form',
                },
            }),
            { port, contracts: contractsRunning('Example Software GmbH') },
        );
        assert.match(message, /says nothing about `vatId`/);
    });

    test('refuses the issuer block being dropped while one is recorded', async () => {
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const message = await refusalOf(catalogWith(undefined), {
            port,
            contracts: contractsRunning('Example Software GmbH'),
        });
        assert.match(message, /no issuer is named at all/);
        assert.match(message, /names no issuer for a declaration to be about/);
        assert.doesNotMatch(
            message,
            /correctionOf:/,
            'the block is gone, so a declaration cannot be in it',
        );
        assert.match(message, / {4}city: "München"/, 'the address the record holds');
    });

    test('and refuses a nameless block however well it is declared, leaving the record', async () => {
        // The shape that would have turned the guard off for good: accepted, the
        // start records a nameless issuer, and every identity after it reads as
        // a first naming. The record staying put is half the assertion.
        const settings = settingsOf(catalogWith(GMBH));
        const port = portRecording(settings);
        const message = await refusalOf(
            catalogWith({
                legalName: '   ',
                correctionOf: {
                    legalName: 'Example Software GmbH',
                    vatId: 'DE123456789',
                    reason: 'Change of legal form',
                },
            }),
            { port, contracts: contractsRunning('Example Software GmbH') },
        );
        assert.match(message, /names no issuer for a declaration to be about/);
        assert.deepEqual(port.applied.settings, settings, 'a nameless issuer was recorded');

        // And the way out it prints is one that works. The declaration is not
        // read on this path at all, and the operator already has exactly the one
        // this would otherwise print — value for value — so printing it back
        // would send them round the same restart into the same message.
        assert.doesNotMatch(message, /correctionOf:/);
        assert.match(message, /Write the issuer block again/);
        assert.match(message, /a second `issuer:` key is a file YAML refuses to read/);
        // The whole block, not the three identity fields: pasting those back
        // would start, with an issuer that has no address — copied onto every
        // contract concluded from then on, and then written over the values
        // that could have been printed here.
        assert.match(message, /issuer:\n {4}legalName: "Example Software GmbH"/);
        assert.match(message, / {4}addressLine1: "Werkstraße 5"/);
        assert.match(message, / {4}postalCode: "80331"/);
        assert.match(message, / {4}city: "München"/);
        assert.match(message, / {4}country: "DE"/);
        assert.match(message, / {4}vatId: "DE123456789"/);
        assert.doesNotMatch(message, /transfer, not an edit of a setting/);
    });

    test('reads the contracts platform-wide, which needs the bypass frame', async () => {
        // At boot there is no tenant, and under row-level security the same read
        // comes back empty: the refusal would say "No contract is running." on
        // an installation with hundreds, and `doctor` would report nought as
        // reassurance. The decision does not depend on it — the message an
        // operator weighs a transfer against does.
        const seen = [];
        const bypass = {
            runWithBypass: async (fn) => {
                seen.push('in');
                return fn();
            },
        };
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const message = await refusalOf(catalogWith({ ...GMBH, legalName: 'Other Software AG' }), {
            port,
            contracts: contractsRunning(GMBH.legalName),
            bypass,
        });
        assert.deepEqual(seen, ['in'], 'the contracts were read outside the bypass');
        assert.match(message, /1 contract\(s\) are still running/);
    });

    test('and the block it prints carries every issuer member the schema declares', async () => {
        // Derived from the schema rather than from a list beside the one in the
        // source: a member added there and not to the printed block would be one
        // an operator silently loses by following the way out. `correctionOf` is
        // the one exception, and it is named as one.
        const declared = Object.keys(planCatalogSchema.properties.issuer.properties).filter(
            (name) => name !== 'correctionOf',
        );
        const full = Object.fromEntries(
            declared.map((name) => [name, name === 'country' ? 'DE' : `value of ${name}`]),
        );
        const port = portRecording(settingsOf(catalogWith(full)));
        const message = await refusalOf(catalogWith(undefined), {
            port,
            contracts: contractsRunning(full.legalName),
        });
        // Read as data rather than matched as a pattern: a name out of the
        // schema built into a regex is a pattern that says something else the
        // day a name carries a metacharacter.
        const lines = message.split('\n');
        const block = lines.slice(lines.lastIndexOf('issuer:') + 1);
        const printed = block
            .filter((line) => line.startsWith('    ') && !line.startsWith('     '))
            .map((line) => line.slice(4).split(':')[0]);
        assert.deepEqual(
            printed.slice().sort(),
            declared.slice().sort(),
            'the block the refusal prints and the members the schema declares',
        );
        assert.ok(declared.length >= 8, `only ${declared.length} members scanned`);
    });

    test('names the contracts up to a limit, and how many more there are', async () => {
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const contracts = contractsRunning(...Array.from({ length: 7 }, () => GMBH.legalName));
        const message = await refusalOf(catalogWith({ ...GMBH, legalName: 'Other Software AG' }), {
            port,
            contracts,
        });
        assert.match(message, /7 contract\(s\) are still running/);
        assert.match(message, /… and 2 more\./);
        assert.equal(
            message.split('\n').filter((line) => /^ {2}contract-/.test(line)).length,
            5,
            'a refusal that scrolls loses the line that says the way out',
        );
    });

    test('does not count a contract whose term has run out', async () => {
        // How an ordinary cancellation leaves a contract: `effectiveUntil` at the
        // term end and the status untouched, because nothing flips it when that
        // day arrives. Counting by status alone would report every customer who
        // ever left as still running — and, oldest first, name exactly those.
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const contracts = contractsRunning(
            { legalName: GMBH.legalName, endedAt: new Date('2026-03-01T00:00:00.000Z') },
            { legalName: GMBH.legalName, endedAt: new Date('2099-01-01T00:00:00.000Z') },
            GMBH.legalName,
        );
        const message = await refusalOf(catalogWith({ ...GMBH, legalName: 'Other Software AG' }), {
            port,
            contracts,
        });
        assert.match(message, /2 contract\(s\) are still running/);
        assert.doesNotMatch(message, /contract-1 /, 'the expired one was named');
        assert.match(message, /contract-2 /);
        assert.match(message, /contract-3 /);
    });

    test('names a legal name that YAML would otherwise not read back', async () => {
        // The block a refusal prints is the way out of it, so it has to parse.
        // A registered name holding `: ` is ordinary.
        const awkward = { ...GMBH, legalName: 'Beispiel: Software GmbH' };
        const port = portRecording(settingsOf(catalogWith(awkward)));
        const message = await refusalOf(catalogWith({ ...awkward, legalName: 'Other AG' }), {
            port,
            contracts: contractsRunning(awkward.legalName),
        });
        assert.match(message, /legalName: "Beispiel: Software GmbH"/);
    });

    test('says which contracts carry no issuer copy rather than pretending they do', async () => {
        // What the migration that attached contracts concluded before
        // subscribers existed leaves behind: a party copy with no issuer in it.
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const message = await refusalOf(catalogWith({ ...GMBH, legalName: 'Other Software AG' }), {
            port,
            contracts: contractsRunning(null),
        });
        assert.match(message, /names no issuer/);
    });
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('what the comparison needs, and what it does without', () => {
    test('an installation that records nothing compares the issuer with nothing, and says so', async () => {
        const said = await capturingLogs(async () => {
            app = await boot(catalogWith(GMBH), { contracts: contractsRunning(GMBH.legalName) });
        });
        assert.ok(
            said.warn.some((line) => /compared with nothing/.test(line)),
            said.warn,
        );
    });

    test('a record that cannot be read stops a start that names an issuer', async () => {
        const port = new FakeAppliedSettingsPort();
        port.readApplied = async () => {
            throw new Error('connection refused');
        };
        const message = await refusalOf(catalogWith(GMBH), { port });
        assert.match(message, /could not be compared/);
        assert.match(message, /connection refused/);
    });

    test('and only warns where the file names no issuer at all', async () => {
        // The counter-weight: an installation that never named a legal entity
        // has none to conclude a contract on behalf of, and the record's own
        // promise — a record that cannot be kept still runs the right
        // configuration — is worth more than a boot refused over a comparison
        // with nothing on one side.
        const port = new FakeAppliedSettingsPort();
        port.readApplied = async () => {
            throw new Error('connection refused');
        };
        const said = await capturingLogs(async () => {
            app = await boot(catalogWith(undefined), { port });
        });
        assert.ok(
            said.warn.some((line) => /compared with nothing.*connection refused/s.test(line)),
            said.warn,
        );
    });

    test('an installation that writes no contracts at all still refuses another entity', async () => {
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        const message = await refusalOf(catalogWith({ ...GMBH, legalName: 'Other Software AG' }), {
            port,
        });
        assert.match(message, /This installation writes no contracts\./);
        assert.match(message, /not the legal entity this installation recorded/);
    });
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('what this start found stays what this start found', () => {
    test('a reader afterwards is told the correction, not that nothing moved', async () => {
        // The recorder replaces the record moments after the comparison, in a
        // bootstrap hook. Asked again, an unsettled comparison would find the
        // file agreeing with what this very start wrote — so `<app> doctor`, on
        // the start that carried a correction through, would report that
        // nothing had moved.
        const corrected = {
            ...GMBH,
            legalName: 'Example Software AG',
            correctionOf: { legalName: 'Example Software GmbH', reason: 'Change of legal form' },
        };
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        app = await boot(catalogWith(corrected), {
            port,
            contracts: contractsRunning(GMBH.legalName),
        });

        assert.equal(
            port.applied.settings.issuer.legalName,
            'Example Software AG',
            'the record was replaced, which is what makes this worth asserting',
        );
        const verdict = await app.get(IssuerIdentityInspector).inspect();
        assert.equal(verdict.change.kind, 'corrected');
        assert.equal(verdict.change.reason, 'Change of legal form');
    });

    test('and the contracts it would be weighed against are counted on request', async () => {
        // Not on the verdict: a start needs the contracts only to name them in a
        // refusal, and no boot should pay for a number nobody reads at a boot.
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        app = await boot(catalogWith(GMBH), {
            port,
            contracts: contractsRunning(GMBH.legalName, GMBH.legalName, null),
        });
        assert.equal(await app.get(IssuerIdentityInspector).runningContractCount(), 3);
    });

    test('and nothing is counted where no repository answers', async () => {
        const port = portRecording(settingsOf(catalogWith(GMBH)));
        app = await boot(catalogWith(GMBH), { port });
        assert.equal(await app.get(IssuerIdentityInspector).runningContractCount(), null);
    });
});

describe('the comparison happens before the record is replaced', () => {
    test('the check is a module hook and the recorder a bootstrap hook', () => {
        // The comparison is against the PREVIOUS start's values, so it has to
        // run before `AppliedSettingsRecorder` replaces them. Nest runs every
        // `onModuleInit` before a single `onApplicationBootstrap`, which is what
        // holds the two apart — and the module graph is not what holds them,
        // so no booted application can show it: moving the check to a bootstrap
        // hook leaves every test above green, because the container happens to
        // reach it first today. What is asserted is therefore the decision
        // itself, which is the thing that would be changed.
        assert.equal(typeof IssuerIdentityCheck.prototype.onModuleInit, 'function');
        assert.equal(
            IssuerIdentityCheck.prototype.onApplicationBootstrap,
            undefined,
            'a bootstrap hook would race the recorder, which is one',
        );
        // And the inspector carries no hook at all, so asking the question
        // costs nothing: `<app> doctor` injects it, and a class whose
        // construction is also a lifecycle hook could not be injected for that.
        assert.equal(IssuerIdentityInspector.prototype.onModuleInit, undefined);
        assert.equal(IssuerIdentityInspector.prototype.onApplicationBootstrap, undefined);
        assert.equal(typeof AppliedSettingsRecorder.prototype.onApplicationBootstrap, 'function');
        assert.equal(
            AppliedSettingsRecorder.prototype.onModuleInit,
            undefined,
            'the recorder moving up would replace the record before it is compared',
        );
    });
});

// @requirement SC-CFG-036 — The record of the applied configuration is a mirror, never a source of settings
describe('the record is still a mirror', () => {
    test('a record disagreeing about every other value changes nothing about what runs', async () => {
        // What the one exemption costs, bounded: the check reads the recorded
        // ISSUER IDENTITY and nothing else. A record naming another currency,
        // another notice period and another issuer ADDRESS starts, and the
        // values the application runs on are the file's.
        const stale = {
            ...settingsOf(catalogWith({ ...GMBH, addressLine1: 'Alte Straße 9', city: 'Hamburg' })),
            currency: 'CHF',
            vatRate: 7.7,
            tenantBilling: {
                cancellationNoticeDays: { monthly: 1, yearly: 1 },
                selfServiceBlockedPlans: BLOCKED,
            },
        };
        const port = portRecording(stale);
        app = await boot(catalogWith(GMBH), { port, contracts: contractsRunning(GMBH.legalName) });
        const verdict = await app.get(IssuerIdentityInspector).inspect();
        assert.equal(verdict.change.kind, 'unchanged');
        assert.equal(port.applied.settings.currency, 'EUR', 'the file is what runs');
        assert.equal(port.applied.settings.issuer.city, 'München');
    });
});
