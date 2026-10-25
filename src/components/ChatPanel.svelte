<script lang="ts">
  import { tick } from "svelte";
  import type { Doc } from "../lib/doc.svelte";
  import { chatFor, send } from "../lib/ai.svelte";
  import { renderMarkdown } from "../lib/markdown";
  import { persist, settings } from "../lib/settings.svelte";
  import { openDialog } from "../lib/ui.svelte";
  import { viewer } from "../lib/viewer.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  const chat = $derived(chatFor(doc));
  let input = $state("");
  let list: HTMLDivElement;

  const suggestions = $derived([t("ai.suggestSummary"), t("ai.suggestPoints"), t("ai.suggestPage", { n: doc.current + 1 })]);

  async function submit(text = input) {
    const prompt = text.trim();
    if (!prompt || chat.running) return;
    input = "";
    const done = send(doc, chat, prompt);
    await tick();
    scrollDown();
    await done;
    scrollDown();
  }

  function scrollDown() {
    list?.scrollTo({ top: list.scrollHeight });
  }

  $effect(() => {
    // Follow the streamed reply.
    void chat.entries.length;
    void chat.entries[chat.entries.length - 1]?.text;
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 120) scrollDown();
  });

  function onClick(e: MouseEvent) {
    const cite = (e.target as HTMLElement).closest<HTMLElement>("button.cite");
    if (cite) viewer.goTo(Number(cite.dataset.page) - 1, true);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }
</script>

<aside class="chat">
  <div class="head">
    <span class="title"><Icon name="sparkles" size={14} />{t("ai.title")}</span>
    {#if settings.profiles.length}
      <select class="field small" bind:value={settings.activeProfileId} onchange={persist} aria-label={t("ai.provider")}>
        {#each settings.profiles as p (p.id)}<option value={p.id}>{p.name} · {p.model}</option>{/each}
      </select>
    {/if}
    <button class="icon-btn" onclick={() => chat.clear()} disabled={!chat.entries.length || chat.running} title={t("ai.clear")} aria-label={t("ai.clear")}><Icon name="trash" /></button>
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="messages selectable" bind:this={list} onclick={onClick}>
    {#if !settings.profiles.length}
      <div class="empty">
        <span class="spark"><Icon name="sparkles" size={22} /></span>
        <p>{t("ai.setupBody")}</p>
        <button class="btn primary" onclick={() => openDialog("settings", { tab: "ai" })}>{t("ai.setup")}</button>
        <p class="muted small-text">{t("ai.privacy")}</p>
      </div>
    {:else if !chat.entries.length}
      <div class="empty">
        <span class="spark"><Icon name="sparkles" size={22} /></span>
        <p class="muted">{t("ai.intro")}</p>
        <div class="suggestions">
          {#each suggestions as s (s)}<button class="chip" onclick={() => submit(s)}>{s}</button>{/each}
        </div>
        <p class="muted small-text">{t("ai.privacy")}</p>
      </div>
    {/if}
    {#each chat.entries as entry, i (i)}
      {#if entry.role === "user"}
        <div class="msg user">{entry.text}</div>
      {:else if entry.role === "tool"}
        <div class="msg tool" class:error={entry.error}><Icon name="check" size={12} class="tool-icon" /> {entry.text}</div>
      {:else}
        <div class="msg assistant" class:error={entry.error}>
          {#if entry.text}{@html renderMarkdown(entry.text)}{:else}<span class="typing"><Icon name="loader" size={12} class="spin" />{t("common.working")}</span>{/if}
        </div>
      {/if}
    {/each}
  </div>

  <div class="composer">
    <textarea class="field" rows="3" placeholder={t("ai.placeholder")} bind:value={input} onkeydown={onKey} disabled={!settings.profiles.length}></textarea>
    {#if chat.running}
      <button class="icon-btn" onclick={() => (chat.signal.cancelled = true)} title={t("ai.stop")} aria-label={t("ai.stop")}><Icon name="stop" /></button>
    {:else}
      <button class="icon-btn send" onclick={() => submit()} disabled={!input.trim() || !settings.profiles.length} title={t("ai.send")} aria-label={t("ai.send")}><Icon name="send" /></button>
    {/if}
  </div>
</aside>

<style>
  .chat {
    width: 340px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--line);
    background: var(--panel);
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 8px 9px 12px;
    border-bottom: 1px solid var(--line);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    font: 500 15px var(--serif);
    letter-spacing: -0.01em;
  }
  .title :global(svg) {
    color: var(--accent);
  }
  .small {
    height: 26px;
    font-size: 11.5px;
    flex: 1;
    min-width: 0;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
    padding: 20px 4px;
    line-height: 1.55;
  }
  .empty p {
    margin: 0;
  }
  .spark {
    color: var(--accent);
    line-height: 0;
  }
  .small-text {
    font-size: 11px;
  }
  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }
  .chip {
    border: 1px solid var(--line);
    background: var(--panel-2);
    color: var(--muted);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    text-align: left;
    transition:
      border-color 0.15s,
      color 0.15s;
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .msg {
    max-width: 100%;
    line-height: 1.55;
    word-wrap: break-word;
  }
  .msg.user {
    margin-left: 24px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
    padding: 8px 12px;
    border-radius: 8px;
    white-space: pre-wrap;
  }
  .msg.assistant {
    margin-right: 16px;
  }
  .msg.assistant :global(p) {
    margin: 0 0 8px;
  }
  .msg.assistant :global(ul),
  .msg.assistant :global(ol) {
    margin: 0 0 8px;
    padding-left: 20px;
  }
  .msg.assistant :global(h4) {
    margin: 8px 0 4px;
    font: 500 14px var(--serif);
  }
  .msg.assistant :global(pre) {
    background: var(--bg);
    border: 1px solid var(--line);
    padding: 8px;
    border-radius: 6px;
    overflow-x: auto;
    font: 11.5px var(--mono);
  }
  .msg.assistant :global(code) {
    font: 11.5px var(--mono);
  }
  .msg.assistant :global(.cite) {
    border: none;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    border-radius: 4px;
    padding: 0 5px;
    font: 500 10.5px var(--mono);
  }
  .msg.assistant :global(.cite:hover) {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }
  .msg.tool {
    font-size: 11px;
    color: var(--muted);
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .msg.tool :global(.tool-icon) {
    color: var(--accent);
    flex: none;
  }
  .msg.error {
    color: var(--danger);
  }
  .msg.assistant.error {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
  }
  .typing {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 11px;
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    padding: 12px;
    border-top: 1px solid var(--line);
  }
  .composer textarea {
    flex: 1;
    resize: none;
    max-height: 160px;
  }
  .send:not(:disabled) {
    background: var(--accent);
    color: var(--ink);
  }
  .send:not(:disabled):hover {
    background: var(--accent);
    filter: brightness(1.1);
  }
</style>
