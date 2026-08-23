# UI primitives

The `Admin*` roster: the components a standard admin page is built from.
Anything not on this list comes from Quasar directly and is styled through
the theme — buttons, inputs, tabs and badges are Quasar components, and
wrapping them would add a layer that only forwards.

When to reach for which, and the page recipe they assemble into, are in the
[design guide](../explanation/design-guide.md).

Generated from `packages/ui-vue/src/ui` — 22 components. Do not edit by hand:
`node scripts/gen-docs/index.mjs --write`.

## Page skeleton

### `<AdminAccordion>`

| Prop       | Type                     |              |
| ---------- | ------------------------ | ------------ |
| `open`     | `boolean`                | **required** |
| `disabled` | `boolean`                | optional     |
| `markTone` | `'accent' \| 'negative'` | optional     |

### `<AdminBody>`

| Prop          | Type      |          |
| ------------- | --------- | -------- |
| `loading`     | `boolean` | optional |
| `empty`       | `boolean` | optional |
| `loadingText` | `string`  | optional |
| `emptyText`   | `string`  | optional |

### `<AdminField>`

| Prop       | Type                    |              |
| ---------- | ----------------------- | ------------ |
| `label`    | `string`                | **required** |
| `hint`     | `string`                | optional     |
| `error`    | `string \| null`        | optional     |
| `required` | `boolean`               | optional     |
| `for`      | `string`                | optional     |
| `span`     | `1 \| 2 \| 3 \| 'full'` | optional     |

### `<AdminFieldGrid>`

| Prop      | Type          |          |
| --------- | ------------- | -------- |
| `columns` | `1 \| 2 \| 3` | optional |

### `<AdminFilters>`

Takes no props — it is composed through its slots.

### `<AdminHero>`

| Prop       | Type     |              |
| ---------- | -------- | ------------ |
| `title`    | `string` | **required** |
| `subtitle` | `string` | optional     |
| `level`    | `1 \| 2` | optional     |

### `<AdminPage>`

Takes no props — it is composed through its slots.

### `<AdminSection>`

| Prop       | Type     |          |
| ---------- | -------- | -------- |
| `title`    | `string` | optional |
| `subtitle` | `string` | optional |

### `<AdminToolbar>`

| Prop     | Type                            |          |
| -------- | ------------------------------- | -------- |
| `sticky` | `boolean`                       | optional |
| `align`  | `'start' \| 'between' \| 'end'` | optional |

## Data display

### `<AdminKpi>`

| Prop       | Type                                                                             |              |
| ---------- | -------------------------------------------------------------------------------- | ------------ |
| `label`    | `string`                                                                         | **required** |
| `value`    | `string \| number \| null`                                                       | optional     |
| `sub`      | `string`                                                                         | optional     |
| `tone`     | `'neutral' \| 'positive' \| 'info' \| 'warn' \| 'danger' \| 'muted' \| 'purple'` | optional     |
| `emphasis` | `'value' \| 'surface'`                                                           | optional     |
| `icon`     | `string`                                                                         | optional     |
| `layout`   | `'stacked' \| 'inline'`                                                          | optional     |
| `action`   | `() => void`                                                                     | optional     |
| `selected` | `boolean`                                                                        | optional     |

### `<AdminPaginator>`

| Prop          | Type                |              |
| ------------- | ------------------- | ------------ |
| `page`        | `number`            | **required** |
| `rowsPerPage` | `number`            | **required** |
| `total`       | `number`            | **required** |
| `pageSizes`   | `readonly number[]` | optional     |
| `storageKey`  | `string`            | optional     |

Emits: `update:page`, `update:rowsPerPage`.

### `<AdminRowActions>`

| Prop      | Type                        |              |
| --------- | --------------------------- | ------------ |
| `actions` | `readonly AdminRowAction[]` | **required** |

Emits: `action`.

### `<AdminStatistics>`

| Prop      | Type     |          |
| --------- | -------- | -------- |
| `columns` | `number` | optional |
| `label`   | `string` | optional |

### `<AdminStatusPill>`

| Prop      | Type                  |              |
| --------- | --------------------- | ------------ |
| `label`   | `string`              | **required** |
| `tone`    | `PillTone`            | **required** |
| `icon`    | `string`              | optional     |
| `variant` | `'soft' \| 'outline'` | optional     |
| `size`    | `'sm' \| 'md'`        | optional     |

### `<AdminTable>`

| Prop          | Type                                 |              |
| ------------- | ------------------------------------ | ------------ |
| `rows`        | `readonly Record<string, unknown>[]` | **required** |
| `columns`     | `QTableColumn[]`                     | **required** |
| `rowKey`      | `string`                             | optional     |
| `loading`     | `boolean`                            | optional     |
| `emptyText`   | `string`                             | optional     |
| `storageKey`  | `string`                             | optional     |
| `serverSide`  | `boolean`                            | optional     |
| `page`        | `number`                             | optional     |
| `rowsPerPage` | `number`                             | optional     |
| `total`       | `number`                             | optional     |

Emits: `update:page`, `update:rowsPerPage`.

## Feedback

### `<AdminBanner>`

| Prop          | Type                                              |          |
| ------------- | ------------------------------------------------- | -------- |
| `tone`        | `'info' \| 'positive' \| 'warning' \| 'negative'` | optional |
| `title`       | `string`                                          | optional |
| `icon`        | `string \| false`                                 | optional |
| `dense`       | `boolean`                                         | optional |
| `dismissible` | `boolean`                                         | optional |

Emits: `dismiss`.

### `<AdminEmptyState>`

| Prop          | Type                  |              |
| ------------- | --------------------- | ------------ |
| `title`       | `string`              | **required** |
| `description` | `string`              | optional     |
| `icon`        | `string`              | optional     |
| `size`        | `'inline' \| 'block'` | optional     |

### `<AdminErrorBanner>`

| Prop    | Type                          |              |
| ------- | ----------------------------- | ------------ |
| `error` | `unknown \| null`             | **required** |
| `title` | `string`                      | optional     |
| `retry` | `() => void \| Promise<void>` | optional     |

### `<AdminRefreshBtn>`

| Prop      | Type      |          |
| --------- | --------- | -------- |
| `loading` | `boolean` | optional |
| `label`   | `string`  | optional |

Emits: `refresh`.

## Dialogs

### `<AdminConfirmDialog>`

| Prop             | Type                                  |              |
| ---------------- | ------------------------------------- | ------------ |
| `modelValue`     | `boolean`                             | **required** |
| `title`          | `string`                              | **required** |
| `message`        | `string`                              | optional     |
| `size`           | `'sm' \| 'md' \| 'lg'`                | optional     |
| `tone`           | `'neutral' \| 'warning' \| 'danger'`  | optional     |
| `confirmLabel`   | `string`                              | optional     |
| `cancelLabel`    | `string`                              | optional     |
| `requireTyped`   | `{ label: string; expected: string }` | optional     |
| `confirm`        | `() => Promise<unknown>`              | **required** |
| `successMessage` | `string`                              | optional     |

Emits: `update:modelValue`, `confirmed`.

### `<AdminDialog>`

| Prop         | Type                                     |              |
| ------------ | ---------------------------------------- | ------------ |
| `modelValue` | `boolean`                                | **required** |
| `title`      | `string`                                 | **required** |
| `subtitle`   | `string`                                 | optional     |
| `size`       | `'sm' \| 'md' \| 'lg' \| 'xl' \| 'full'` | optional     |
| `persistent` | `boolean`                                | optional     |
| `loading`    | `boolean`                                | optional     |

Emits: `update:modelValue`.

### `<AdminFormDialog>`

| Prop             | Type                                     |              |
| ---------------- | ---------------------------------------- | ------------ |
| `modelValue`     | `boolean`                                | **required** |
| `title`          | `string`                                 | **required** |
| `subtitle`       | `string`                                 | optional     |
| `size`           | `'sm' \| 'md' \| 'lg' \| 'xl' \| 'full'` | optional     |
| `submitLabel`    | `string`                                 | optional     |
| `cancelLabel`    | `string`                                 | optional     |
| `submitDisabled` | `boolean`                                | optional     |
| `submit`         | `() => Promise<unknown>`                 | **required** |
| `successMessage` | `string`                                 | optional     |

Emits: `update:modelValue`, `submitted`.
