<script lang="ts">
  // The Bookmarks tab of the sidebar: the document's outline, to jump around
  // and to edit. Every edit is undoable and saved into the PDF.
  import { tick } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { Doc } from "../lib/doc.svelte";
  import { bookmarkId, currentBookmark, find, indent, insertionIndex, locate, move, outdent, remove, type Bookmark } from "../lib/outline";
  import { fitOnSheet } from "../lib/paper";
  import { viewer } from "../lib/viewer.svelte";
  import { openMenu } from "../lib/contextmenu.svelte";
  import { isMac } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  let selected = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let draft = $state("");
  let input = $state<HTMLInputElement | null>(null);

  const current = $derived(currentBookmark(doc.outline, doc.pages, doc.current));

  function pageNumber(b: Bookmark): number {
    return b.page ? doc.pages.findIndex((p) => p.id === b.page) + 1 : 0;
  }

  /** How far down its page a bookmark points, as a share of the page as shown. */
  function shareDown(b: Bookmark): number {
    const p = doc.pages.find((x) => x.id === b.page);
    if (!p || b.y == null) return 0;
    const rot = doc.rotation(p);
    if (rot === 90 || rot === 270) return 0;
    const y = rot === 180 ? p.h - b.y : b.y;
    if (!p.sheet) return y / p.h;
    // On new paper the page is scaled down and centered.
    const { s } = fitOnSheet(p.w, p.h, p.sheet);
    return ((p.sheet.h - p.h * s) / 2 + y * s) / p.sheet.h;
  }

  function open(b: Bookmark) {
    selected = b.id;
    const n = pageNumber(b);
    if (n > 0) viewer.goTo(n - 1, false, shareDown(b));
    else if (b.url && /^(https?|mailto):/i.test(b.url)) openUrl(b.url);
  }

  /** A new bookmark for the page being read, named after the selected text if there is some. */
  export async function add(asChildOf: string | null = null) {
    const p = doc.pages[doc.current];
    if (!p) return;
    const picked = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    const title = picked && picked.length <= 120 ? picked : t("outline.untitled", { n: doc.current + 1 });
    const at = viewer.scrolledInto(doc.current);
    const y = doc.rotation(p) === 0 && !p.sheet && at > 0 ? at * p.h : null;
    const b: Bookmark = { id: bookmarkId(), title, page: p.id, y, open: true, children: [] };
    doc.editOutline((list) => {
      const parent = asChildOf ? find(list, asChildOf) : null;
      if (parent) {
        parent.children.splice(insertionIndex(parent.children, doc.pages, doc.current + 1), 0, b);
        parent.open = true;
      } else list.splice(insertionIndex(list, doc.pages, doc.current + 1), 0, b);
    });
    selected = b.id;
    await startEditing(b);
    input?.select();
  }

  async function startEditing(b: Bookmark) {
    selected = b.id;
    draft = b.title;
    editing = b.id;
    await tick();
    input?.focus();
  }

  function commit() {
    const id = editing;
    editing = null;
    if (!id) return;
    const title = draft.replace(/\s+/g, " ").trim();
    const b = find(doc.outline, id);
    if (!b || !title || title === b.title) return;
    doc.editOutline((list) => {
      const target = find(list, id);
      if (target) target.title = title;
    });
  }

  function edit(fn: (list: Bookmark[]) => boolean) {
    // Only edits that change something are recorded.
    const trial = $state.snapshot(doc.outline) as Bookmark[];
    if (fn(trial)) doc.editOutline((list) => void fn(list));
  }

  function removeBookmark(id: string) {
    doc.editOutline((list) => void remove(list, id));
    if (selected === id) selected = null;
  }

  function pointHere(id: string) {
    const p = doc.pages[doc.current];
    if (!p) return;
    doc.editOutline((list) => {
      const b = find(list, id);
      if (b) {
        b.page = p.id;
        b.y = null;
      }
    });
  }

  function onMenu(e: MouseEvent, b: Bookmark) {
    selected = b.id;
    const at = locate(doc.outline, b.id);
    const first = !at || at.index === 0;
    const last = !at || at.index === at.list.length - 1;
    openMenu(e, [
      { label: t("outline.rename"), icon: "edit-text", shortcut: isMac ? "↩" : "F2", run: () => startEditing(b) },
      { label: t("outline.addChild"), icon: "bookmark-add", run: () => add(b.id) },
      { label: t("outline.setPage"), icon: "bookmark", run: () => pointHere(b.id) },
      "sep",
      { label: t("outline.moveUp"), icon: "up", disabled: first, run: () => edit((l) => move(l, b.id, -1)) },
      { label: t("outline.moveDown"), icon: "down", disabled: last, run: () => edit((l) => move(l, b.id, 1)) },
      { label: t("outline.indent"), icon: "right", disabled: first, run: () => edit((l) => indent(l, b.id)) },
      { label: t("outline.outdent"), icon: "left", disabled: !at?.parent, run: () => edit((l) => outdent(l, b.id)) },
      "sep",
      { label: t("outline.delete"), icon: "trash", shortcut: isMac ? "⌫" : "Del", danger: true, run: () => removeBookmark(b.id) },
    ]);
  }

  function onKey(e: KeyboardEvent, b: Bookmark) {
    if (editing) return;
    const keys: Record<string, () => void> = {
      Enter: () => (isMac ? startEditing(b) : open(b)),
      F2: () => startEditing(b),
      Delete: () => removeBookmark(b.id),
      Backspace: () => removeBookmark(b.id),
    };
    const run = keys[e.key];
    if (!run) return;
    // Not the page's own Delete and Enter.
    e.preventDefault();
    e.stopPropagation();
    run();
  }

  // Keep the bookmark of the page being read in view.
  let list = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const id = current;
    const el = id ? list?.querySelector<HTMLElement>(`[data-bookmark="${id}"]`) : null;
    el?.scrollIntoView({ block: "nearest" });
  });
</script>

<div class="outline" bind:this={list} role="tree" aria-label={t("sidebar.outline")}>
  {#if !doc.outline.length}
    <div class="empty">
      <p class="muted">{t("outline.empty")}</p>
      <button class="btn" onclick={() => add()}><Icon name="bookmark-add" size={14} />{t("outline.add")}</button>
    </div>
  {:else}
    {@render rows(doc.outline, 0)}
  {/if}
</div>

{#snippet rows(items: Bookmark[], depth: number)}
  {#each items as b (b.id)}
    {@const n = pageNumber(b)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="row"
      class:current={current === b.id}
      class:selected={selected === b.id}
      style:padding-left="{4 + depth * 12}px"
      data-bookmark={b.id}
      role="treeitem"
      tabindex="-1"
      aria-selected={selected === b.id}
      aria-expanded={b.children.length ? b.open : undefined}
      title={b.page ? b.title : b.url || t("outline.noPage")}
      onclick={() => editing !== b.id && open(b)}
      ondblclick={() => startEditing(b)}
      oncontextmenu={(e) => onMenu(e, b)}
      onkeydown={(e) => onKey(e, b)}
    >
      {#if b.children.length}
        <button
          class="twisty"
          tabindex="-1"
          aria-label={b.title}
          onclick={(e) => {
            e.stopPropagation();
            // Folding is a way of looking, not an edit.
            b.open = !b.open;
          }}
        >
          <Icon name={b.open ? "down" : "right"} size={12} />
        </button>
      {:else}
        <span class="twisty"></span>
      {/if}
      {#if editing === b.id}
        <input
          class="field"
          bind:this={input}
          bind:value={draft}
          aria-label={t("outline.title")}
          onclick={(e) => e.stopPropagation()}
          onblur={commit}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") input?.blur();
            if (e.key === "Escape") {
              editing = null;
            }
          }}
        />
      {:else}
        <span class="label" class:bold={b.bold} class:italic={b.italic} class:dim={!n && !b.url}>{b.title || "—"}</span>
        {#if n}<span class="num">{n}</span>{/if}
      {/if}
    </div>
    {#if b.open && b.children.length}
      {@render rows(b.children, depth + 1)}
    {/if}
  {/each}
{/snippet}

<style>
  .outline {
    flex: 1;
    overflow-y: auto;
    padding: 6px 4px 24px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 8px;
  }
  .empty p {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 26px;
    padding-right: 6px;
    border-radius: 6px;
    cursor: pointer;
    outline: none;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.selected {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .row.current .label {
    color: var(--accent);
  }
  .twisty {
    flex: none;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
  }
  button.twisty:hover {
    color: var(--text);
  }
  .label {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label.bold {
    font-weight: 600;
  }
  .label.italic {
    font-style: italic;
  }
  .label.dim {
    color: var(--muted);
  }
  .num {
    flex: none;
    font: 10.5px var(--mono);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .row input {
    flex: 1;
    min-width: 0;
    height: 22px;
    font-size: 12px;
    padding: 0 6px;
    -webkit-user-select: text;
    user-select: text;
  }
</style>
