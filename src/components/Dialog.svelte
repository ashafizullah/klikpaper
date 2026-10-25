<script lang="ts">
  import type { Snippet } from "svelte";
  import { closeDialog } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { title, children, footer, width = 440 }: { title: string; children: Snippet; footer?: Snippet; width?: number } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && closeDialog(null)}>
  <div class="dialog rise" role="dialog" aria-modal="true" aria-label={title} style:width="{width}px">
    <header>
      <h2>{title}</h2>
      <button class="icon-btn" onclick={() => closeDialog(null)} aria-label={t("common.close")}><Icon name="close" /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(10 8 6 / 0.7);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 150;
    padding: 24px;
  }
  .dialog {
    max-width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 10px 16px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font: 500 17px var(--serif);
    letter-spacing: -0.01em;
  }
  .body {
    padding: 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 12px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--line);
  }
  .body :global(.form-row) {
    display: grid;
    grid-template-columns: 130px 1fr;
    align-items: center;
    gap: 10px;
  }
  .body :global(.form-row > span:first-child) {
    font: 500 10px var(--mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .body :global(.note) {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--muted);
    margin: 0;
  }
  .body :global(.choice) {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
