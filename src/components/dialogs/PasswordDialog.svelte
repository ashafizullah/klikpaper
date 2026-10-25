<script lang="ts">
  import Dialog from "../Dialog.svelte";
  import { closeDialog } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { file, retry }: { file: string; retry: boolean } = $props();
  let password = $state("");
</script>

<Dialog title={t("password.title")} width={380}>
  <p class="note">{t("password.body", { file })}</p>
  <!-- svelte-ignore a11y_autofocus -->
  <input class="field" type="password" bind:value={password} autofocus onkeydown={(e) => e.key === "Enter" && password && closeDialog(password)} aria-label={t("password.label")} />
  {#if retry}<p class="error-text">{t("password.wrong")}</p>{/if}
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!password} onclick={() => closeDialog(password)}>{t("password.open")}</button>
  {/snippet}
</Dialog>
