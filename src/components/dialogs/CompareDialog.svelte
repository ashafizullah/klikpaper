<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import type { Change } from "../../lib/compare";
  import { changeText, compareVersions, versionFromFile, versionOf, type Comparison, type Version } from "../../lib/compare-docs";
  import { errorText } from "../../lib/ipc";
  import { renderToBlob } from "../../lib/pdfjs";
  import { PDF_FILTER } from "../../lib/workspace.svelte";
  import { closeDialog } from "../../lib/ui.svelte";
  import { t, type Key } from "../../lib/i18n/index.svelte";
  import Icon from "../Icon.svelte";

  /** `against`: a file to compare with right away (the older version). */
  let { doc, against }: { doc: Doc; against?: string } = $props();
  // svelte-ignore state_referenced_locally
  const mine = versionOf(doc);
  let other = $state<Version | null>(null);
  /** This document is the newer version (the picked file the older one). */
  let mineIsNewer = $state(true);
  let result = $state<Comparison | null>(null);
  let working = $state(false);
  let error = $state<string | null>(null);
  let selected = $state(0);

  const before = $derived(other ? (mineIsNewer ? other : mine) : null);
  const after = $derived(other ? (mineIsNewer ? mine : other) : null);
  const changes = $derived(result?.changes ?? []);
  const current = $derived<Change | null>(changes[selected] ?? null);
  const count = (k: Change["kind"]) => changes.filter((c) => c.kind === k).length;

  async function pick() {
    const path = await openFileDialog({ multiple: false, filters: PDF_FILTER });
    if (!path || Array.isArray(path)) return;
    await load(path);
  }

  async function load(path: string) {
    other?.close();
    other = null;
    try {
      other = await versionFromFile(path);
      await run();
    } catch (e) {
      error = errorText(e);
    }
  }

  async function run() {
    if (!before || !after) return;
    working = true;
    error = null;
    result = null;
    selected = 0;
    try {
      result = await compareVersions(before, after);
    } catch (e) {
      error = errorText(e);
    } finally {
      working = false;
    }
  }

  onMount(() => {
    if (against) load(against);
  });

  function swap() {
    mineIsNewer = !mineIsNewer;
    run();
  }

  // ---- page pictures with the changed words marked -----------------------------------------

  const WIDTH = 380;
  const pictures = new Map<string, Promise<{ url: string; w: number; h: number }>>();
  function picture(v: Version, side: string, page: number) {
    const key = `${side}:${v.id}:${page}`;
    let hit = pictures.get(key);
    if (!hit) {
      hit = (async () => {
        const p = await v.page(page);
        const [x0, y0, x1, y1] = p.view;
        const blob = await renderToBlob(p, (WIDTH * 2) / (x1 - x0), 0, "image/jpeg", 0.85);
        return { url: URL.createObjectURL(blob), w: x1 - x0, h: y1 - y0 };
      })();
      pictures.set(key, hit);
    }
    return hit;
  }
  onDestroy(() => {
    for (const p of pictures.values()) p.then((x) => URL.revokeObjectURL(x.url)).catch(() => {});
    other?.close();
  });

  /** Boxes to mark on a page of one side: the selected change strongly, others on that page faintly. */
  function marks(side: "before" | "after", page: number) {
    const out: { x: number; y: number; w: number; h: number; on: boolean }[] = [];
    changes.forEach((c, i) => {
      for (const word of side === "before" ? c.before : c.after) {
        if (word.page !== page) continue;
        for (const r of word.rects) out.push({ ...r, on: i === selected });
      }
    });
    return out;
  }

  function onKey(e: KeyboardEvent) {
    if (!changes.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") selected = Math.min(changes.length - 1, selected + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") selected = Math.max(0, selected - 1);
    else return;
    e.preventDefault();
    document.querySelector(`[data-change="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }
</script>

<svelte:window onkeydown={onKey} />

<Dialog title={t("cmp.title")} width={1180}>
  {#if !other}
    <p class="note">{t("cmp.intro")}</p>
    <div><button class="btn primary" onclick={pick}><Icon name="files" size={14} />{t("cmp.pick")}</button></div>
  {:else}
    <div class="versions">
      <span><span class="muted">{t("cmp.older")}</span> <strong>{before?.name}</strong></span>
      <button class="icon-btn" onclick={swap} title={t("cmp.swap")} aria-label={t("cmp.swap")}><Icon name="refresh" size={14} /></button>
      <span><span class="muted">{t("cmp.newer")}</span> <strong>{after?.name}</strong></span>
      <button class="btn" onclick={pick}>{t("cmp.pick")}</button>
    </div>
    {#if working}
      <p class="note">{t("cmp.working")}</p>
    {:else if result}
      {#if result.emptyBefore || result.emptyAfter}<p class="warn">{t("cmp.scans", { n: Math.max(result.emptyBefore, result.emptyAfter) })}</p>{/if}
      {#if result.changes === null}
        <p class="note">{t("cmp.tooDifferent")}</p>
      {:else if !changes.length}
        <p class="note">{t("cmp.same")}</p>
      {:else}
        <p class="note">{t("cmp.summary", { n: changes.length, added: count("added"), removed: count("removed"), changed: count("changed") })}</p>
        <div class="view">
          <ul class="changes selectable">
            {#each changes as c, i (i)}
              {@const text = changeText(c)}
              <li>
                <button class="change" class:on={i === selected} data-change={i} onclick={() => (selected = i)}>
                  <span class="meta"><span class="kind {c.kind}">{t(`cmp.${c.kind}` as Key)}</span> {t("cmp.pages", { a: c.pageBefore + 1, b: c.pageAfter + 1 })}</span>
                  {#if text.before}<span class="del">{text.before}</span>{/if}
                  {#if text.after}<span class="ins">{text.after}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
          {#if current && before && after}
            <div class="pages">
              {#each [{ v: before, side: "before" as const, page: current.pageBefore }, { v: after, side: "after" as const, page: current.pageAfter }] as s (s.side)}
                <figure>
                  <figcaption>{s.side === "before" ? t("cmp.older") : t("cmp.newer")} · {t("pages.page", { n: s.page + 1 })}</figcaption>
                  {#await picture(s.v, s.side, s.page)}
                    <div class="placeholder"></div>
                  {:then pic}
                    <div class="sheet" style:aspect-ratio="{pic.w} / {pic.h}">
                      <img src={pic.url} alt="" />
                      {#each marks(s.side, s.page) as m, k (k)}
                        <span
                          class="mark {s.side}"
                          class:on={m.on}
                          style:left="{(m.x / pic.w) * 100}%"
                          style:top="{(m.y / pic.h) * 100}%"
                          style:width="{(m.w / pic.w) * 100}%"
                          style:height="{(m.h / pic.h) * 100}%"
                        ></span>
                      {/each}
                    </div>
                  {/await}
                </figure>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <p class="note muted">{t("cmp.limits")}</p>
    {/if}
  {/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  {#snippet footer()}
    {#if changes.length}
      <button class="btn" disabled={selected === 0} onclick={() => (selected = Math.max(0, selected - 1))}><Icon name="up" size={14} />{t("cmp.prev")}</button>
      <button class="btn" disabled={selected >= changes.length - 1} onclick={() => (selected = Math.min(changes.length - 1, selected + 1))}><Icon name="down" size={14} />{t("cmp.next")}</button>
    {/if}
    <button class="btn primary" onclick={() => closeDialog(null)}>{t("common.ok")}</button>
  {/snippet}
</Dialog>

<style>
  .versions {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
    flex-wrap: wrap;
  }
  .versions .btn {
    margin-left: auto;
  }
  .warn {
    margin: 0;
    font-size: 12px;
    color: var(--accent);
  }
  .view {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 12px;
    height: min(62vh, 640px);
  }
  .changes {
    list-style: none;
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .change {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 7px 8px;
    border: none;
    border-radius: 6px;
    background: none;
    text-align: left;
    font-size: 12px;
    color: var(--text);
  }
  .change:hover {
    background: var(--hover);
  }
  .change.on {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .meta {
    font: 10.5px var(--mono);
    color: var(--muted);
  }
  .kind {
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .kind.added {
    color: var(--ok);
  }
  .kind.removed {
    color: var(--danger);
  }
  .kind.changed {
    color: var(--accent);
  }
  .del {
    color: var(--danger);
    text-decoration: line-through;
    overflow-wrap: anywhere;
  }
  .ins {
    color: var(--ok);
    overflow-wrap: anywhere;
  }
  .pages {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    overflow-y: auto;
    align-items: start;
  }
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  figcaption {
    font: 10.5px var(--mono);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .sheet {
    position: relative;
    background: #fff;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.45);
  }
  .sheet img {
    display: block;
    width: 100%;
    height: 100%;
  }
  .placeholder {
    aspect-ratio: 1 / 1.41;
    background: color-mix(in srgb, #fff 8%, transparent);
  }
  .mark {
    position: absolute;
    border-radius: 2px;
    mix-blend-mode: multiply;
    opacity: 0.35;
  }
  .mark.before {
    background: #f26d6d;
  }
  .mark.after {
    background: #6fcf7a;
  }
  .mark.on {
    opacity: 0.85;
    outline: 1.5px solid var(--accent);
    outline-offset: 1px;
  }
</style>
