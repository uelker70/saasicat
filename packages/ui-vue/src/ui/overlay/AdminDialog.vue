<template>
    <q-dialog
        :model-value="modelValue"
        :persistent="persistent || loading"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <q-card class="sa-dialog" :data-size="size" role="dialog" :aria-labelledby="headingId">
            <header class="sa-dialog__head">
                <div class="sa-dialog__heading">
                    <h2 :id="headingId" class="sa-dialog__title">{{ title }}</h2>
                    <p v-if="subtitle" class="sa-dialog__sub">{{ subtitle }}</p>
                </div>
                <div v-if="$slots['header-extra']" class="sa-dialog__head-extra">
                    <slot name="header-extra" />
                </div>
            </header>
            <div class="sa-dialog__body"><slot /></div>
            <footer v-if="$slots.footer" class="sa-dialog__footer"><slot name="footer" /></footer>
            <q-inner-loading :showing="loading" />
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { useId } from 'vue';

// The chrome every dialog in the admin shares. Twenty-one places opened a
// `q-dialog` by hand and each drew its own head: three different title
// typographies, two different paddings, and one that had no heading element at
// all — so a screen reader announced "dialog" and nothing else.
//
// `title` is required for that reason, and it is what `aria-labelledby` points
// at. The same trick as AdminHero: a component that cannot be built without a
// name cannot ship an unnamed one.
//
// `loading` implies `persistent`. A dialog that is mid-request must not close
// on a backdrop click — the request will still land, and the operator is left
// with no idea whether it did.
//
// The footer is a slot rather than a pair of label props because a plain
// AdminDialog does not know what its buttons mean. The two cases that DO know
// are AdminFormDialog and AdminConfirmDialog, and they fill it themselves.
withDefaults(
    defineProps<{
        modelValue: boolean;
        title: string;
        subtitle?: string;
        size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
        /** Blocks the backdrop and the escape key. */
        persistent?: boolean;
        /** Covers the card with a spinner and implies `persistent`. */
        loading?: boolean;
    }>(),
    { subtitle: undefined, size: 'md', persistent: false, loading: false },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const headingId = useId();
</script>
