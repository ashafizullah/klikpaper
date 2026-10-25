<script lang="ts">
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { errorText, ipc } from "../../lib/ipc";
  import { splitDoc } from "../../lib/save.svelte";
  import { joinPath, splitGroups, stripExt } from "../../lib/pagespec";
  import { closeDialog, toast } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();
  let mode = $state<"every" | "ranges">("every");
  let every = $state(1);
  let ranges = $state("");
  let working = $state(false);
  let error = $state<string | null>(null);

  const groups = $derived(mode === "every" ? splitGroups(doc.pages.length, { every }) : splitGroups(doc.pages.length, { ranges }));

  async function run() {
    if (!groups) return;
    const dir = await openFileDialog({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    const base = stripExt(doc.name);
    const width = String(groups.length).length;
    const planned = groups.map((_, g) => joinPath(dir, `${base}-${String(g + 1).padStart(width, "0")}.pdf`));
    const clash = (await ipc.fileStats(planned)).find((s) => s.exists);
    if (clash) {
      error = t("split.exists", { file: clash.path });
      return;
    }
    working = true;
    error = null;
    try {
      const files = await splitDoc(doc, groups, dir);
      toast(t("split.done", { n: files.length }), "ok", { label: t("common.showInFolder"), run: () => revealItemInDir(files[0]) });
      closeDialog(files);
    } catch (e) {
      error = errorText(e);
    } finally {
      working = false;
    }
  }
</script>

<Dialog title={t("split.title")} width={440}>
  <label class="row"><input type="radio" bind:group={mode} value="every" />{t("split.every")}</label>
  {#if mode === "every"}
    <label class="form-row"><span>{t("split.pagesPerFile")}</span><input class="field" type="number" min="1" max={doc.pages.length} bind:value={every} /></label>
  {/if}
  <label class="row"><input type="radio" bind:group={mode} value="ranges" />{t("split.ranges")}</label>
  {#if mode === "ranges"}
    <input class="field" placeholder="1-3; 4-8; 9-" bind:value={ranges} spellcheck="false" />
    <p class="note">{t("split.rangesHint")}</p>
  {/if}
  <p class="note">{groups ? t("split.result", { n: groups.length }) : t("split.invalid")}</p>
  {#if error}<p class="error-text">{error}</p>{/if}
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!groups || working} onclick={run}>{working ? t("common.working") : t("split.run")}</button>
  {/snippet}
</Dialog>
