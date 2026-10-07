// Which issuer an invoice names (`SC-PRIC-026`).
//
// The identity — the legal name and the tax identifiers — is the counterparty
// the contract was concluded with, so it is taken from the copy on the
// contract, with every correction the operator declared for that same entity
// since applied. The address and the contact details come from
// `config/saas.yaml` while it names that identity, and from the contract's
// copy otherwise.
//
// The declared corrections are read from the settings record: each start that
// found the identity changed kept the file it applied, declaration included
// (`SC-CFG-025`), and a start refuses a change nobody declared. Followed from
// the copy, change by change, they lead to the file's identity where the copy
// names the same entity. Where they do not — an installation that records no
// settings, or a file changed while nothing compared it — the invoice names
// the contract's copy as it stands: a contract is never invoiced on behalf of
// an entity it was not concluded with.
//
// Pure: the invoice run reads the copy, the file and the record, and asks this.

import type { AppliedSettingsValues, SettingsChangeRecord } from './applied-settings.types.js';
import { classifyIssuerChange, recordedIssuerIdentity } from './issuer-identity.js';
import { sameLegalIdentity, type LegalIdentity } from './legal-identity.js';
import type { PlanCatalogIssuer } from './plan-catalog.types.js';
import type { ContractIssuerParty } from './subscription-contract.types.js';
import type { SubscriptionInvoiceIssuer } from './subscription-invoice.types.js';

/** A recorded settings change, as far as the issuer's history needs it. */
export type IssuerHistoryStep = Pick<SettingsChangeRecord, 'previous' | 'current'>;

/**
 * The issuer an invoice of a contract names.
 *
 * `copy` is the issuer the contract copied when it was concluded; `configured`
 * the issuer `config/saas.yaml` names on the issue date, as a contract would
 * copy it now (`contractPartiesOf`), or `null` where it names none; `history`
 * the recorded settings changes, the oldest first.
 */
export function invoiceIssuerOf(
    copy: ContractIssuerParty,
    configured: ContractIssuerParty | null,
    history: readonly IssuerHistoryStep[],
): SubscriptionInvoiceIssuer {
    const target = configured && identityOf(configured);
    let reached = identityOf(copy);
    if (!target || !reached) return { ...copy };
    for (const step of history) {
        if (sameLegalIdentity(reached, target)) break;
        const change = classifyIssuerChange(
            recordedIssuerIdentity(step.previous),
            issuerBlockOf(step.current),
        );
        if (change.kind === 'corrected' && sameLegalIdentity(change.recorded, reached)) {
            reached = change.current;
        }
    }
    return sameLegalIdentity(reached, target) ? { ...configured } : { ...copy };
}

/** A party's identity, settled the way the start settles the file's and the record's. */
function identityOf(party: ContractIssuerParty): LegalIdentity | null {
    return recordedIssuerIdentity({ issuer: party });
}

/** The issuer block of a recorded file, where it holds one that can be read as a block. */
function issuerBlockOf(values: AppliedSettingsValues): PlanCatalogIssuer | undefined {
    const issuer = values.issuer;
    if (issuer === null || typeof issuer !== 'object' || Array.isArray(issuer)) return undefined;
    // Read field by field by `classifyIssuerChange`, every one through a
    // reader that takes anything, so a block an earlier version wrote in
    // another shape reads as no identity rather than as a wrong one.
    return issuer as PlanCatalogIssuer;
}
