# eslint-plugin-saasicat

## What this is

The four rules this repository needs and nobody ships: a ceiling on props, a ban
on callback props, a ban on raw HTTP, and a list of framework components a
design-system primitive already answers.

Each is the machine form of a decision that would otherwise be repeated in
review. `no-function-props` alone is the whole of
[ADR 0008](../../docs/explanation/adr/0008-resource-ports-over-props.md); a
decision that lives only in a document is a request.

## What this is not

Not published, and not a general-purpose plugin. It is workspace tooling, wired
into `eslint.config.mjs` with the directories and limits this repository has —
the rules take those as options rather than hard-coding a tree, so nothing here
assumes a layout other than through configuration.

Not a replacement for the repo-wide tests either. A rule sees one file with no
type information: `onSave?: () => void` falls here, `onSave?: SaveHandler` needs
the compiler, and `packages/ui-vue/tests/pages-take-no-callbacks.test.js` is
what resolves that. Each rule's header says which half it cannot see.

## Rules

| Rule                       | Options                          | Answers                                         |
| -------------------------- | -------------------------------- | ----------------------------------------------- |
| `max-props`                | `{ "<path fragment>": <limit> }` | A page is at most five props wide.              |
| `no-function-props`        | `{ directories: [] }`            | A page takes no callbacks.                      |
| `no-raw-http`              | `{ allow: [] }`                  | Every request goes through the injected client. |
| `no-restricted-components` | `{ components: {}, allow: [] }`  | `<q-dialog>` and its kin belong to `src/ui/`.   |

## Next

- [Pages take resources, not callbacks](../../docs/explanation/adr/0008-resource-ports-over-props.md)
- [Design guide](../../docs/explanation/design-guide.md) — the roster these components stand in for
