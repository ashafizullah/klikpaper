<script lang="ts">
  import { untrack } from "svelte";
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { closeDialog } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();
  // The dialog edits a copy; nothing changes until Apply.
  const initial = untrack(() => ({ protect: doc.protect, strip: doc.stripMetadata, flatten: doc.flattenForms }));
  let protect = $state(!!initial.protect);
  let password = $state(initial.protect ?? "");
  let confirm = $state(initial.protect ?? "");
  let strip = $state(initial.strip);
  let flatten = $state(initial.flatten);
  const wasProtected = !!initial.protect;

  const mismatch = $derived(protect && password !== confirm);
  const valid = $derived(!protect || (password.length > 0 && !mismatch));

  function apply() {
    const next = protect ? password : null;
    if (next !== doc.protect || strip !== doc.stripMetadata || flatten !== doc.flattenForms) {
      doc.protect = next;
      doc.stripMetadata = strip;
      doc.change(() => (doc.flattenForms = flatten));
    }
    closeDialog(true);
  }
</script>

<Dialog title={t("security.title")} width={460}>
  <label class="row"><input type="checkbox" bind:checked={protect} />{t("security.protect")}</label>
  {#if protect}
    <label class="form-row"><span>{t("security.password")}</span><input class="field" type="password" bind:value={password} autocomplete="new-password" /></label>
    <label class="form-row"><span>{t("security.confirm")}</span><input class="field" type="password" bind:value={confirm} autocomplete="new-password" /></label>
    {#if mismatch && confirm}<p class="error-text">{t("security.mismatch")}</p>{/if}
    <p class="note">{t("security.protectNote")}</p>
  {:else if wasProtected}
    <p class="note">{t("security.unlockNote")}</p>
  {/if}
  <label class="row"><input type="checkbox" bind:checked={strip} />{t("security.strip")}</label>
  <p class="note">{t("security.stripNote")}</p>
  <label class="row"><input type="checkbox" bind:checked={flatten} />{t("security.flatten")}</label>
  <p class="note">{t("security.flattenNote")}</p>
  <p class="note">{t("security.appliedOnSave")}</p>
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!valid} onclick={apply}>{t("common.apply")}</button>
  {/snippet}
</Dialog>
