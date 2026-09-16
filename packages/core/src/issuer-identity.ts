// Whether the issuer `config/saas.yaml` names is the legal entity the
// installation recorded at its last start, and what follows from a difference.
//
// The issuer's identity is the counterparty every contract names. A contract
// copies it on the day it is concluded and never follows a later change, so an
// installation whose file suddenly names another entity would keep billing
// contracts on behalf of somebody they were not concluded with. Nothing here
// can tell a correction of the same entity from another one taking over — a
// renamed GmbH and its successor read identically — so the operator declares
// which it is, and an undeclared change is refused rather than guessed at.
//
// Pure, and framework-free: the start asks this, `saasicat doctor` asks it
// again before a deploy, and neither wants a database to answer it.

import type { AppliedSettingsValues } from './applied-settings.types.js';
import {
    LEGAL_IDENTITY_FIELDS,
    movedIdentityFields,
    sameLegalIdentity,
    type LegalIdentity,
    type LegalIdentityField,
} from './legal-identity.js';
import type { PlanCatalogIssuer, PlanCatalogIssuerCorrection } from './plan-catalog.types.js';

/**
 * The legal identity of the issuer a catalogue names, or none where it names no
 * issuer.
 *
 * Settled through the same reader as the recorded side, and that symmetry is
 * the point rather than tidiness: the record is a verbatim copy of the file, so
 * a value whose two sides were settled differently would differ from itself. A
 * legal name written with a trailing space would then refuse the SECOND start on
 * a file nobody touched, and no declaration could make it stop happening.
 */
export function issuerIdentityOf(issuer: PlanCatalogIssuer | undefined): LegalIdentity | null {
    if (!issuer) return null;
    // Named field by field rather than cast: the three names are then checked
    // against `PlanCatalogIssuer`, so a field renamed in the schema is a
    // compile error here instead of an identity that silently reads as unknown.
    return identityOf({
        legalName: issuer.legalName,
        vatId: issuer.vatId,
        taxNumber: issuer.taxNumber,
    });
}

/**
 * The issuer identity a recorded settings tree holds.
 *
 * Read defensively rather than cast: the record is JSON as some earlier version
 * of this platform wrote it, and a tree without an issuer, or with one whose
 * legal name is not a name, is read as "no identity was recorded" — which is
 * the first naming, not a change. The schema keeps a name of only whitespace out
 * of the file; this keeps one out of a record written before it did.
 */
export function recordedIssuerIdentity(
    settings: AppliedSettingsValues | null | undefined,
): LegalIdentity | null {
    const issuer = settings?.issuer;
    if (issuer === null || typeof issuer !== 'object' || Array.isArray(issuer)) return null;
    return identityOf(issuer as Record<string, unknown>);
}

/** The three fields off an issuer block, settled, or `null` where it has no name. */
function identityOf(source: Record<string, unknown>): LegalIdentity | null {
    const legalName = textOrNull(source.legalName);
    if (legalName === null) return null;
    return {
        legalName,
        vatId: textOrNull(source.vatId),
        taxNumber: textOrNull(source.taxNumber),
    };
}

/** Why `issuer.correctionOf` does not cover the change it is there to declare. */
export type IssuerCorrectionFault =
    /** There is no declaration at all. */
    | { kind: 'absent' }
    /**
     * The file names no issuer for a declaration to be about — the block is
     * gone, or it is there with a name that reads as nothing. Never a
     * correction, whatever is declared: there is no entity on this side for the
     * recorded one to be the same as.
     */
    | { kind: 'names-no-issuer' }
    /**
     * It names a value the record does not hold. Either the declaration is
     * stale — it belongs to a correction already applied — or it is about
     * another entity than the one this installation recorded.
     */
    | {
          kind: 'names-another-value';
          field: LegalIdentityField;
          declared: string | null;
          recorded: string | null;
      }
    /** It says nothing about a field the change moves, so that field is undeclared. */
    | { kind: 'leaves-a-field-out'; field: LegalIdentityField; recorded: string | null };

/** What a start finds when it compares the file's issuer with the recorded one. */
export type IssuerIdentityChange =
    /** Neither the record nor the file names an issuer. */
    | { kind: 'none-named' }
    /** The same entity, whatever the address and the contact details did. */
    | { kind: 'unchanged'; identity: LegalIdentity }
    /**
     * The first issuer this installation names. No contract can have been
     * concluded under another one, so nothing is declared for it.
     */
    | { kind: 'first-naming'; identity: LegalIdentity }
    /** The same entity, corrected as the file declares. `current` is never absent. */
    | {
          kind: 'corrected';
          recorded: LegalIdentity;
          current: LegalIdentity;
          moved: readonly LegalIdentityField[];
          reason: string;
      }
    /** Another identity, with no declaration that covers it. Refused. */
    | {
          kind: 'undeclared';
          recorded: LegalIdentity;
          /** `null` where the file dropped the issuer block altogether. */
          current: LegalIdentity | null;
          moved: readonly LegalIdentityField[];
          fault: IssuerCorrectionFault;
      };

/**
 * What the issuer in the file is, against the identity the record holds.
 *
 * `recorded` is `null` on the very first start, and on an installation that
 * has never named an issuer.
 */
export function classifyIssuerChange(
    recorded: LegalIdentity | null,
    issuer: PlanCatalogIssuer | undefined,
): IssuerIdentityChange {
    const current = issuerIdentityOf(issuer);
    if (!recorded)
        return current ? { kind: 'first-naming', identity: current } : { kind: 'none-named' };
    if (current && sameLegalIdentity(recorded, current))
        return { kind: 'unchanged', identity: current };
    // Dropping the issuer block drops the declaration with it, so a file that
    // names no issuer while one is recorded is always undeclared. What moved is
    // then every field the record actually held a value for.
    if (!current) {
        // Refused before the declaration is even read, and that ordering is the
        // guard: a block whose name reads as nothing yields no identity, so a
        // declaration naming the recorded values would otherwise pass — and the
        // start would record a nameless issuer. The next start would read that
        // record as "none recorded", call every identity after it a first
        // naming, and never refuse anything again.
        const moved = LEGAL_IDENTITY_FIELDS.filter((field) => recorded[field] !== null);
        return {
            kind: 'undeclared',
            recorded,
            current: null,
            moved,
            fault: { kind: 'names-no-issuer' },
        };
    }
    const moved = movedIdentityFields(recorded, current);
    const fault = faultIn(issuer?.correctionOf, recorded, moved);
    if (fault) return { kind: 'undeclared', recorded, current, moved, fault };
    // `faultIn` answers `absent` without a declaration, so there is one here.
    const declaration = issuer?.correctionOf as PlanCatalogIssuerCorrection;
    return { kind: 'corrected', recorded, current, moved, reason: declaration.reason };
}

/**
 * What is wrong with the declaration, or `null` where it covers the change.
 *
 * Two rules, and the second is the one that does the work: every value the
 * declaration names has to be the value the record holds, and every field the
 * change moves has to be named. Naming a field that did not move is allowed —
 * its value is the recorded one by definition, so the declaration is merely
 * fuller than it had to be, and refusing that would be pedantry an operator
 * meets at a restart.
 */
function faultIn(
    declaration: PlanCatalogIssuerCorrection | undefined,
    recorded: LegalIdentity,
    moved: readonly LegalIdentityField[],
): IssuerCorrectionFault | null {
    if (!declaration) return { kind: 'absent' };
    for (const field of LEGAL_IDENTITY_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(declaration, field)) continue;
        // Settled like both sides it is compared against, for the same reason.
        const declared = textOrNull(declaration[field]);
        if (declared !== recorded[field]) {
            return { kind: 'names-another-value', field, declared, recorded: recorded[field] };
        }
    }
    for (const field of moved) {
        if (Object.prototype.hasOwnProperty.call(declaration, field)) continue;
        return { kind: 'leaves-a-field-out', field, recorded: recorded[field] };
    }
    return null;
}

function textOrNull(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}
