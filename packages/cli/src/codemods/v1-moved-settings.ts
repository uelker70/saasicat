// Finds the settings that moved out of `TenantBillingModule.forRoot()` and
// into `config/saas.yaml`.
//
// Reports them. Does not remove them, and the line sits differently here than
// in the codemod next door — the one that takes a retired identifier out.
//
// A removal there lost a redundant word. A removal here would lose a commercial
// decision: `cancellationNoticeDays: { monthly: 30, yearly: 90 }` is a term
// somebody negotiated, and deleting it from the code without writing it into
// the file would leave an application whose notice period silently became
// whatever the file happens to say. That is the failure the move exists to
// prevent, committed by the tool that is supposed to perform it.
//
// So this names the line and the value stays where a person can read it. What
// makes that safe rather than lax is the other half of the change: the module
// refuses to boot while either option is still passed, so nobody can act on
// this report halfway and find out in production.
//
// Pure functions, like the other three codemods: the caller reads and writes
// the files, which is what makes the rules testable without one.

import { planCatalogSchema } from '@saasicat/spec';

/**
 * The settings that belong in `config/saas.yaml#tenantBilling`, read off the
 * schema that defines them.
 *
 * Not a list here, and not a copy of the one in `@saasicat/nest`: both derive
 * from the same schema, so the day a third setting moves into that block, this
 * codemod names it and the module refuses it without either being edited.
 */
export const SETTINGS_THAT_MOVED: readonly string[] = Object.keys(
    (
        planCatalogSchema as {
            properties?: { tenantBilling?: { properties?: Record<string, unknown> } };
        }
    ).properties?.tenantBilling?.properties ??
        (() => {
            throw new Error(
                'plan-catalog.schema.json declares no tenantBilling properties — ' +
                    '@saasicat/spec and @saasicat/cli are out of step.',
            );
        })(),
);

export type MovedSetting = string;

export interface MovedSettingOccurrence {
    /** Which setting it is, so the report can say where it goes. */
    readonly setting: MovedSetting;
    /** 1-based line number. */
    readonly line: number;
}

export interface MovedSettingsResult {
    readonly occurrences: readonly MovedSettingOccurrence[];
}

const isIdentifierChar = (ch: string | undefined): boolean =>
    ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

function lineAt(text: string, index: number): number {
    let line = 1;
    for (let at = 0; at < index; at += 1) {
        if (text[at] === '\n') line += 1;
    }
    return line;
}

/**
 * Every occurrence of a moved setting in one source file.
 *
 * Matched as a whole identifier followed by a colon, so a string in a log line
 * or a longer name that ends in it is not reported — the report is only worth
 * reading if every line in it is one somebody has to act on.
 *
 * A property access (`config.cancellationNoticeDays`) is reported too: reading
 * the value back from module options is the same migration, one step further
 * along.
 */
export function findMovedSettings(text: string): MovedSettingsResult {
    const occurrences: MovedSettingOccurrence[] = [];

    for (const setting of SETTINGS_THAT_MOVED) {
        for (let at = text.indexOf(setting); at >= 0; at = text.indexOf(setting, at + 1)) {
            if (isIdentifierChar(text[at - 1])) continue;
            if (isIdentifierChar(text[at + setting.length])) continue;
            occurrences.push({ setting, line: lineAt(text, at) });
        }
    }

    return {
        occurrences: occurrences.sort(
            (a, b) => a.line - b.line || a.setting.localeCompare(b.setting),
        ),
    };
}

/**
 * Where a setting goes, for the report.
 *
 * One sentence per setting rather than one for both: they end up in the same
 * block and mean different things, and "move these two to the file" is the
 * instruction people follow halfway.
 */
export const WHERE_IT_GOES: Record<string, string> = {
    cancellationNoticeDays:
        'config/saas.yaml → tenantBilling.cancellationNoticeDays — both `monthly` and ' +
        '`yearly` are required, so write the number you are running today rather than ' +
        'leaving one out.',
    selfServiceBlockedPlans:
        'config/saas.yaml → tenantBilling.selfServiceBlockedPlans — both `asTarget` and ' +
        '`asSource` are required, and `[]` is the way to say "nothing is blocked".',
};
