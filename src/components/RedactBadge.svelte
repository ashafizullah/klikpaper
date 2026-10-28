<script lang="ts">
  // Toolbar notice while redaction is in use: saving removes the marked content
  // for good and notes the redaction in the file's properties (metadata).
  import type { Doc } from "../lib/doc.svelte";
  import { showAlert, ui } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  const n = $derived(doc.redactions.length);
  const title = $derived(n ? t("redact.badgeTitle", { n }) : t("redact.badgeIdle"));

  async function explain() {
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

{#if n || ui.tool === "redact"}
  <button class="badge" {title} aria-label={title} onclick={explain}>
    <Icon name="redact" size={12} />
    {n ? t("redact.badge", { n }) : t("redact.badgeTool")}
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
</style>
