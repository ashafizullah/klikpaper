<script lang="ts">
  import Dialog from "../Dialog.svelte";
  import { closeDialog } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { name }: { name: string } = $props();
</script>

<Dialog title={t("unsaved.title")} width={400}>
  <p class="note">{t("unsaved.body", { name })}</p>
  {#snippet footer()}
    <button class="btn danger" onclick={() => closeDialog("discard")}>{t("unsaved.discard")}</button>
    <span style="flex:1"></span>
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" onclick={() => closeDialog("save")}>{t("unsaved.save")}</button>
  {/snippet}
</Dialog>
