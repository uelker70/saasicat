# Change the feature vocabulary

A contract freezes the feature keys it was concluded with. That is deliberate: a price, a quota or
a feature set changed in the catalogue does not reach an agreement already made. The same freeze
holds when the _names_ change. Rename `ATLAS` to `ATLAS_AES` in your code and in the plan version,
and every contract concluded before keeps granting `ATLAS` — a key no guard asks for any more —
and never `ATLAS_AES`. The tenant paid for the capability and cannot use it.

This guide covers what to do when a feature key is renamed, split, added or dropped while
contracts run. There are two ways, and they answer different situations.

## What a frozen contract grants

A contract grants the features in its snapshot, taken when it was concluded or last changed by a
plan change. Three things follow:

- **A key renamed in the code** is still granted under the old name, and the new name is not.
- **A key added to a plan version in place** does not reach the contracts that version was sold
  under.
- **A key dropped from the code** stays in the snapshot and grants nothing a guard asks for.

A feature marked as not yet rolled out is the one exception: it is withheld from running contracts
too, because it says the capability does not exist, not what was sold.

## First choice: declare the replacement

For a rename or a split, declare which old key the new feature replaces, on the capability that
now implements it:

```ts
@Post('search')
@ImplementsCapability('atlas.search', { feature: 'ATLAS_AES', replaces: ['ATLAS'] })
@RequireFeature('ATLAS_AES')
search() {}
```

Every contract that holds `ATLAS` is granted `ATLAS_AES` as well, at once and with nothing written.
The contract keeps saying what was sold — `ATLAS` — which is what an auditor reads. A split names
the old key on each successor. The old code can be deleted in the same commit.

This is the route for a rename. It costs one line, and there is nothing to run.

## Second choice: carry the vocabulary into the contracts

Some changes have no old key to replace:

- a feature added to a plan version in place, which the contracts sold under it should grant;
- a key dropped for good, which should stop cluttering the snapshots;
- a `replaces` declaration you do not want to keep for ever.

For these, the platform writes a successor for each contract, on your command and never by itself.

### 1. Find the contracts that have fallen behind

```bash
myapp doctor
```

The check `platform.contract-features` names each contract in force whose snapshot holds a key
neither your code nor your catalogue knows (`unknown`), or lacks a feature that the plan version
and add-on versions it covers grant today and no `replaces` declaration carries it to (`missing`).
It reports and changes nothing.

### 2. See what would change

```bash
myapp contracts refresh --all
myapp contracts refresh --contract <id> --contract <id>
```

For each contract the command shows the features it would add and remove, and any change to
quotas, prices, the tax rate or the currency. It writes nothing, and says so.

### 3. Write it

```bash
myapp contracts refresh --all --apply --yes
```

It asks for your identity and, against production, `--yes`. A contract it refuses, or one that
changed while its successor was being written, makes the exit code `6` — after the others are
written, so one contract waiting for a decision does not hold up the rest. Running processes grant
the new features within the minute they may keep an answer.

### What is replaced, and what is copied

By default only the features change. They become what the plan version the subscription is bound
to and the add-on versions the contract covers grant today. Everything else is copied as it stands:
the lines, prices, tax, terms, the add-ons the contract covers or leaves out, its end, and the
parties it was concluded with — including a correction of the subscriber's legal name made since,
which does not reach it. A contract whose subscription is bound to another plan version than it
records is left alone: its features would move to a version it was not sold at.

`--full` re-freezes the contract instead, the way a plan change freezes it: features and quotas from
today's versions, an add-on whose cancellation is declared left out of the snapshot and named, the
lines composed afresh, and the parties copied as they stand today. What the contract agreed beyond
money — its terms, the offer it came from, the promotions and codes it records, each line's minimum
term — is carried over. It refuses every contract whose price, tax rate or currency would come out
different, and names it. A price edited into a plan version in place does not reach a customer this
way; that is a decision you make by hand, with the customer.

Either way, the contract that was in force is kept, marked superseded, next to the successor that
replaces it from the moment you ran the command. The audit log records each successor with the
contract it replaced. A successor that copies its lines is charged nothing of its own: the account
goes on as before.

## Which to use

| Situation                                         | Do                                     |
| ------------------------------------------------- | -------------------------------------- |
| A key is renamed or split in the code             | Declare `replaces`                     |
| A feature is added to a plan version already sold | `contracts refresh`                    |
| A key is dropped for good                         | `contracts refresh`, after the preview |
| A cancelled add-on's quota sits in a snapshot     | `contracts refresh --full`             |
| A price was edited into a plan version in place   | Neither — it needs the customer        |

## What this needs

`contracts refresh` and the `doctor` check exist where tenant billing freezes contracts
(`contractFreeze`). Register the command in your CLI as
[Extend your CLI](extend-your-cli.md) shows.
