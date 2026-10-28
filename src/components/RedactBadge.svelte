<script lang="ts">
  // Toolbar notice about blacking out (redaction): while marks wait to be saved
  // (saving deletes what's under them and notes it in the file), and on a file
  // that was blacked out before.
  import type { Doc } from "../lib/doc.svelte";
  import { showAlert, ui } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  const n = $derived(doc.redactions.length);
  const pending = $derived(n > 0 || ui.tool === "redact");
  const title = $derived(n ? t("redact.badgeTitle", { n }) : ui.tool === "redact" ? t("redact.badgeIdle") : t("redact.fileTitle"));

  async function explain() {
    if (!pending) {
      await showAlert({ title: t("redact.fileHeading"), message: t("redact.fileTitle"), markdown: doc.redactedNote ? `${t("redact.fileNote")}\n\n> ${doc.redactedNote}` : undefined });
      return;
    }
    const choice = await showAlert({
      title: t("redact.badgeHeading"),
      message: title,
      actions: n
        ? [
            { label: t("redact.removeAll"), value: "clear", danger: true },
            { label: t("common.ok"), value: "ok", primary: true },
          ]
        : undefined,
    });
    if (choice === "clear") doc.removeRedactions(doc.redactions.map((r) => r.id));
  }
</script>

{#if pending || doc.redactedNote}
  <button class="badge" class:done={!pending} {title} aria-label={title} onclick={explain}>
    <Icon name="redact" size={12} />
    <span class="text">{n ? t("redact.badge", { n }) : pending ? t("redact.badgeTool") : t("redact.badgeFile")}</span>
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
    border: 1px solid color-mix(in srgb, var(--danger) 50%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
    font-size: 11px;
    white-space: nowrap;
    flex: none;
  }
  .badge:hover {
    background: color-mix(in srgb, var(--danger) 22%, transparent);
  }
  /* A file blacked out before: a quieter reminder. */
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
