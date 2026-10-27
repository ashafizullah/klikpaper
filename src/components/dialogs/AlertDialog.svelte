<script lang="ts">
  // A reusable in-app alert: an icon for its tone, a message, optional Markdown
  // (release notes) and the buttons to answer with. Open it with showAlert(); it
  // resolves with the chosen button's value, or null when dismissed.
  import Dialog from "../Dialog.svelte";
  import Icon from "../Icon.svelte";
  import { closeDialog, type AlertAction, type AlertTone } from "../../lib/ui.svelte";
  import { renderMarkdown } from "../../lib/markdown";
  import { t } from "../../lib/i18n/index.svelte";

  let {
    title,
    message = "",
    markdown = "",
    tone = "info",
    actions = [],
  }: { title: string; message?: string; markdown?: string; tone?: AlertTone; actions?: AlertAction[] } = $props();

  const ICONS: Record<AlertTone, string> = { info: "info", success: "check", error: "alert", update: "download" };
  const buttons = $derived(actions.length ? actions : [{ label: t("common.ok"), value: "ok", primary: true }]);
</script>

<Dialog {title} width={markdown ? 520 : 420}>
  <div class="head">
    <span class="badge {tone}"><Icon name={ICONS[tone]} size={18} /></span>
    {#if message}<p class="message selectable">{message}</p>{/if}
  </div>
  {#if markdown}
    <!-- Escaped first by renderMarkdown, then only its own tags are added back. -->
    <div class="notes selectable">{@html renderMarkdown(markdown)}</div>
  {/if}
  {#snippet footer()}
    {#each buttons as b (b.value)}
      <button class="btn" class:primary={b.primary} class:danger={b.danger} onclick={() => closeDialog(b.value)}>{b.label}</button>
    {/each}
  {/snippet}
</Dialog>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .badge {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .badge.success {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 15%, transparent);
  }
  .badge.error {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }
  .message {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
  }
  .notes {
    max-height: 46vh;
    overflow-y: auto;
    padding: 4px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    font-size: 12.5px;
    line-height: 1.55;
  }
  .notes :global(ul),
  .notes :global(ol) {
    margin: 10px 0;
    padding-left: 18px;
  }
  .notes :global(li + li) {
    margin-top: 6px;
  }
  .notes :global(h4) {
    margin: 12px 0 4px;
    font: 500 12px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .notes :global(p) {
    margin: 10px 0;
  }
  .notes :global(code) {
    font: 11.5px var(--mono);
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--panel-2);
  }
  .notes :global(strong) {
    color: var(--text);
  }
</style>
