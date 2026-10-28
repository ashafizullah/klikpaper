<script lang="ts">
  import type { Doc, Redaction } from "../lib/doc.svelte";
  import { busy, toast, ui } from "../lib/ui.svelte";
  import { textRects } from "../lib/pdfjs";
  import { padForRedaction } from "../lib/selection";
  import { newId } from "../lib/settings.svelte";
  import { viewer } from "../lib/viewer.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  let hits = $state<number[]>([]);
  let searching = $state(false);
  let position = $state(-1);
  let run = 0;

  async function search(q: string) {
    const id = ++run;
    hits = [];
    position = -1;
    ui.findPage = -1;
    const needle = q.trim().toLowerCase();
    if (!needle) return;
    searching = true;
    const found: number[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      const text = (await doc.text(doc.pages[i])).toLowerCase();
      if (id !== run) return;
      if (text.includes(needle)) {
        found.push(i);
        hits = [...found];
        if (position < 0) go(0);
      }
    }
    searching = false;
  }

  function go(n: number) {
    if (!hits.length) return;
    position = (n + hits.length) % hits.length;
    ui.findPage = hits[position];
    viewer.goTo(hits[position]);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(() => search(ui.findQuery), 200);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      go(position + (e.shiftKey ? -1 : 1));
    }
  }

  /** Marks every match on the pages found for redaction, as one undoable change. */
  async function redactAll() {
    const q = ui.findQuery.trim();
    if (!q || !hits.length) return;
    const marks = await busy(t("common.working"), async () => {
      const out: Redaction[] = [];
      for (const i of hits) {
        const page = doc.pages[i];
        for (const match of await textRects(await doc.pdfPage(page), q)) out.push({ id: newId("x"), page: page.id, rects: match.map(padForRedaction) });
      }
      return out;
    });
    if (!marks?.length) return;
    doc.addRedactions(marks);
    toast(t("find.redacted", { n: marks.length }), "ok");
  }

  $effect(() => {
    if (ui.findQuery) search(ui.findQuery);
    return () => {
      run++;
      ui.findPage = -1;
    };
  });
</script>

<div class="findbar">
  <Icon name="search" />
  <input id="find-input" class="field" placeholder={t("find.placeholder")} bind:value={ui.findQuery} oninput={onInput} onkeydown={onKey} spellcheck="false" />
  <span class="status muted">
    {#if searching && !hits.length}{t("find.searching")}{:else if ui.findQuery.trim() && !hits.length}{t("find.none")}{:else if hits.length}{t("find.pages", { i: position + 1, n: hits.length })}{/if}
  </span>
  <button class="icon-btn" onclick={() => go(position - 1)} disabled={!hits.length} aria-label={t("find.prev")} title={t("find.prev")}><Icon name="up" /></button>
  <button class="icon-btn" onclick={() => go(position + 1)} disabled={!hits.length} aria-label={t("find.next")} title={t("find.next")}><Icon name="down" /></button>
  <button class="icon-btn" onclick={redactAll} disabled={!hits.length || searching} aria-label={t("find.redactAll")} title={t("find.redactAll")}><Icon name="redact" /></button>
  <button class="icon-btn" onclick={() => (ui.findOpen = false)} aria-label={t("common.close")} title={t("common.close")}><Icon name="close" /></button>
</div>

<style>
  .findbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .field {
    width: 280px;
  }
  .status {
    font: 11px var(--mono);
    min-width: 120px;
  }
</style>
