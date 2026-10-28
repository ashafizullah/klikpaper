<script lang="ts">
  // Toolbar notice for a digitally signed document: whether its signatures
  // still match it. A click shows the details.
  import type { Doc } from "../lib/doc.svelte";
  import { summarize } from "../lib/signatures";
  import { openDialog } from "../lib/ui.svelte";
  import { t, type Key } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  const summary = $derived(summarize(doc.signatures));
</script>

{#if summary}
  <button class="badge {summary}" title={t(`sig.summary.${summary}` as Key)} onclick={() => openDialog("signatures", { doc })}>
    <Icon name={summary === "valid" ? "shield" : "alert"} size={12} />
    <span class="text">{t(`sig.badge.${summary}` as Key)}</span>
  </button>
{/if}

<style>
  .badge {
    --tone: var(--ok);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 9px;
    margin-left: 6px;
    border: 1px solid color-mix(in srgb, var(--tone) 50%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--tone) 14%, transparent);
    color: var(--tone);
    font-size: 11px;
    white-space: nowrap;
    flex: none;
  }
  .badge:hover {
    background: color-mix(in srgb, var(--tone) 22%, transparent);
  }
  .changed,
  .selfSigned {
    --tone: var(--accent);
  }
  .invalid {
    --tone: var(--danger);
  }
  .unknown {
    --tone: var(--muted);
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
