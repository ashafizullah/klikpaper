<script lang="ts">
  import { onMount } from "svelte";
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { errorText } from "../../lib/ipc";
  import { markPersonal, scanPersonal, type PersonalFind } from "../../lib/personal";
  import { PII_KINDS, type PiiKind } from "../../lib/pii";
  import { closeDialog, openDialog, toast, ui } from "../../lib/ui.svelte";
  import { viewer } from "../../lib/viewer.svelte";
  import { t, type Key } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();
  let finds = $state<PersonalFind[] | null>(null);
  let scans = $state(0);
  let kinds = $state<PiiKind[]>([...PII_KINDS]);
  /** Finds the user unticked. */
  let skipped = $state<string[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const label = (k: PiiKind) => t(`pii.${k}` as Key);

  onMount(() => {
    scanPersonal(doc)
      .then((r) => {
        finds = r.finds;
        scans = r.scans;
      })
      .catch((e) => (error = errorText(e)));
  });

  const count = (k: PiiKind) => finds?.filter((f) => f.kind === k).length ?? 0;
  const chosen = $derived((finds ?? []).filter((f) => kinds.includes(f.kind) && !skipped.includes(f.id)));

  function toggle(f: PersonalFind) {
    skipped = skipped.includes(f.id) ? skipped.filter((id) => id !== f.id) : [...skipped, f.id];
  }

  async function mark() {
    busy = true;
    try {
      const boxes = await markPersonal(doc, chosen);
      ui.tool = "select";
      toast(t("pii.marked", { n: chosen.length, boxes }), "ok", undefined, 8000);
      closeDialog(boxes);
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
  }

  function readScans() {
    closeDialog(null);
    openDialog("ocr", { doc });
  }
</script>

<Dialog title={t("pii.title")} width={520}>
  <p class="note">{t("pii.intro")}</p>
  {#if scans}
    <div class="scans">
      <span>{t("pii.scans", { n: scans })}</span>
      <button class="btn" onclick={readScans}>{t("find.ocr")}</button>
    </div>
  {/if}
  {#if !finds && !error}
    <p class="note">{t("pii.searching")}</p>
  {:else if finds && !finds.length}
    <p class="note">{t("pii.none")}</p>
  {:else if finds}
    <div class="kinds">
      {#each PII_KINDS as k (k)}
        <label class="row" class:empty={!count(k)}>
          <input type="checkbox" bind:group={kinds} value={k} disabled={!count(k)} />
          {label(k)} <span class="n">{count(k)}</span>
        </label>
      {/each}
    </div>
    <ul class="finds selectable">
      {#each finds.filter((f) => kinds.includes(f.kind)) as f (f.id)}
        <li>
          <input type="checkbox" checked={!skipped.includes(f.id)} onchange={() => toggle(f)} aria-label={f.value} />
          <span class="kind">{label(f.kind)}</span>
          <span class="value">{f.value}</span>
          <button class="page" onclick={() => viewer.goTo(f.page, true)} title={t("pages.page", { n: f.page + 1 })}>{t("pii.page", { n: f.page + 1 })}</button>
        </li>
      {/each}
    </ul>
    <p class="note muted">{t("pii.review")}</p>
  {/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!chosen.length || busy} onclick={mark}>{t("pii.mark", { n: chosen.length })}</button>
  {/snippet}
</Dialog>

<style>
  .scans {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 8px;
    font-size: 12px;
  }
  .kinds {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
    font-size: 12.5px;
  }
  .kinds .empty {
    color: var(--muted);
  }
  .n {
    margin-left: 4px;
    font: 11px var(--mono);
    color: var(--muted);
  }
  .finds {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .finds li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    font-size: 12.5px;
  }
  .kind {
    flex: none;
    width: 110px;
    color: var(--muted);
    font-size: 11.5px;
  }
  .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono);
  }
  .page {
    flex: none;
    border: none;
    background: none;
    color: var(--accent);
    font-size: 11.5px;
    padding: 0;
  }
</style>
