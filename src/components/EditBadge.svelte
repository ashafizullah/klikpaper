<script lang="ts">
  // Toolbar notice that changes to the printed text are recorded: while Edit
  // text or White-out is in use (saving adds a line to the file's edit
  // history), and on a file that was edited this way before.
  import type { Doc } from "../lib/doc.svelte";
  import { showAlert, ui } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  const n = $derived(doc.pages.reduce((sum, p) => {
    const e = doc.contentEdits(p.id);
    return sum + e.lines + e.covers;
  }, 0));
  const pending = $derived(n > 0 || ui.tool === "edittext" || ui.tool === "whiteout");
  // Blacked-out parts are in the history too, but the Black out badge already tells about those.
  const edited = $derived(/text changed|content covered/.test(doc.editHistory ?? ""));

  function explain() {
    if (pending) return showAlert({ title: t("edits.heading"), message: t("edits.pending") });
    const lines = (doc.editHistory ?? "").split("\n").filter(Boolean);
    return showAlert({ title: t("edits.historyHeading"), message: t("edits.history"), markdown: lines.map((l) => `- ${l}`).join("\n") });
  }
</script>

{#if pending || edited}
  <button class="badge" class:done={!pending} title={pending ? t("edits.pending") : t("edits.history")} onclick={explain}>
    <Icon name="clock" size={12} />
    <span class="text">{n ? t("edits.badge", { n }) : pending ? t("edits.badgeTool") : t("edits.badgeFile")}</span>
  </button>
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 9px;
    margin-left: 6px;
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    font-size: 11px;
    white-space: nowrap;
    flex: none;
  }
  .badge:hover {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  /* A file edited before: a quieter reminder. */
  .badge.done {
    background: none;
    border-color: var(--line);
    color: var(--muted);
  }
  .badge.done:hover {
    color: var(--text);
    background: var(--hover);
  }
  /* In a narrow window only the icon shows; the tooltip and a click still explain. */
  @media (max-width: 1180px) {
    .text {
      display: none;
    }
    .badge {
      padding: 0 6px;
    }
  }
</style>
