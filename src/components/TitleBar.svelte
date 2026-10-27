<script lang="ts">
  import type { Doc } from "../lib/doc.svelte";
  import { activate, closeDoc, closeHomeTab, closeOthers, docTitle, saveDoc, ws } from "../lib/workspace.svelte";
  import { copyText, openMenu, revealFile, revealLabel } from "../lib/contextmenu.svelte";
  import { command } from "../lib/commands.svelte";
  import { settings } from "../lib/settings.svelte";
  import { isMac, mod, ui } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";
  import McpBadge from "./McpBadge.svelte";

  function tabMenu(e: MouseEvent, d: Doc) {
    const i = ws.docs.indexOf(d);
    openMenu(e, [
      { label: t("common.save"), icon: "save", shortcut: `${mod}S`, run: () => saveDoc(d) },
      d.path && { label: t(revealLabel), icon: "folder", run: () => revealFile(d.path!) },
      d.path && { label: t("ctx.copyPath"), icon: "duplicate", run: () => copyText(d.path!) },
      "sep",
      { label: t("tab.new"), icon: "plus", shortcut: `${mod}T`, run: () => command("new-tab") },
      "sep",
      { label: t("tab.close"), icon: "close", shortcut: `${mod}W`, run: () => closeDoc(d) },
      { label: t("ctx.closeOthers"), disabled: ws.docs.length < 2, run: () => closeOthers(d) },
      { label: t("ctx.closeRight"), disabled: i === ws.docs.length - 1, run: () => closeOthers(d, true) },
    ]);
  }
</script>

<header class="titlebar" class:mac={isMac} data-tauri-drag-region>
  <div class="tabs" data-tauri-drag-region>
    {#each ws.docs as d (d.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="tab" class:active={d.id === ws.activeId} title={d.path ?? d.name} oncontextmenu={(e) => tabMenu(e, d)}>
        <button class="tab-main" onclick={() => activate(d)}>
          <Icon name="file" size={13} />
          {#if d.dirty}<span class="dot" aria-label={t("tab.unsaved")}></span>{/if}
          <span class="name">{docTitle(d)}</span>
        </button>
        <button class="tab-close" onclick={() => closeDoc(d)} aria-label={t("tab.close")} title="{t('tab.close')} ({mod}W)">
          <Icon name="close" size={12} />
        </button>
      </div>
    {/each}
    {#if ws.homeTab}
      <div class="tab" class:active={!ws.activeId}>
        <button class="tab-main" onclick={() => (ws.activeId = null)}>
          <Icon name="home" size={13} />
          <span class="name">{t("tab.home")}</span>
        </button>
        <button class="tab-close" onclick={closeHomeTab} aria-label={t("tab.close")} title="{t('tab.close')} ({mod}W)">
          <Icon name="close" size={12} />
        </button>
      </div>
    {/if}
    {#if ws.docs.length}
      <button class="icon-btn new" onclick={() => command("new-tab")} title="{t('tab.new')} ({mod}T)" aria-label={t("tab.new")}>
        <Icon name="plus" size={14} />
      </button>
    {/if}
  </div>
  <div class="right">
    <McpBadge />
    <button class="icon-btn" class:on={ui.terminal} onclick={() => command("toggle-terminal")} title={t("terminal.title") + " (Ctrl+`)"} aria-label={t("terminal.title")}>
      <Icon name="terminal" />
    </button>
    <button class="icon-btn" class:on={settings.showComments} onclick={() => command("toggle-comments")} title={t("comments.title")} aria-label={t("comments.title")}>
      <Icon name="comments" />
    </button>
    <button class="icon-btn" class:on={settings.showChat} onclick={() => command("toggle-ai")} title="{t('ai.title')} ({mod}J)" aria-label={t("ai.title")}>
      <Icon name="chat" />
    </button>
    <button class="icon-btn" onclick={() => command("settings")} title={t("settings.title")} aria-label={t("settings.title")}>
      <Icon name="settings" />
    </button>
  </div>
</header>

<style>
  .titlebar {
    height: 40px;
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 0 10px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }
  .titlebar.mac {
    padding-left: 80px;
  }
  .tabs {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    max-width: 220px;
    min-width: 96px;
    height: 31px;
    border-radius: 8px 8px 0 0;
    border: 1px solid transparent;
    border-bottom: none;
    color: var(--muted);
    font-size: 12px;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .tab:hover {
    background: color-mix(in srgb, var(--panel-2) 60%, transparent);
    color: var(--text);
  }
  .tab.active {
    background: var(--panel);
    border-color: var(--line);
    color: var(--text);
    margin-bottom: -1px;
    height: 32px;
  }
  .tab.active::before {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    top: -1px;
    height: 2px;
    border-radius: 0 0 2px 2px;
    background: var(--accent);
  }
  .tab-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 100%;
    padding: 0 4px 0 11px;
    border: none;
    background: none;
    text-align: left;
  }
  .tab-main :global(svg) {
    flex: none;
    color: var(--muted);
  }
  .tab.active .tab-main :global(svg) {
    color: var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  .tab-close {
    width: 20px;
    height: 20px;
    margin-right: 6px;
    border: none;
    border-radius: 4px;
    background: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    flex: none;
    opacity: 0;
  }
  .tab:hover .tab-close,
  .tab.active .tab-close {
    opacity: 1;
  }
  .tab-close:hover {
    background: var(--panel-2);
    color: var(--text);
  }
  .new {
    width: 26px;
    height: 26px;
    margin: 0 0 3px 4px;
    color: var(--muted);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 4px;
    align-self: center;
  }
</style>
