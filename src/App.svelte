<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { activeDoc, openPaths, ws } from "./lib/workspace.svelte";
  import { command, imagesToPdf, onKeydown } from "./lib/commands.svelte";
  import { ipc } from "./lib/ipc";
  import { settings } from "./lib/settings.svelte";
  import { startMcp } from "./lib/mcp.svelte";
  import { initUpdates } from "./lib/updates.svelte";
  import { initShell } from "./lib/shell.svelte";
  import { ui } from "./lib/ui.svelte";
  import { i18n, t } from "./lib/i18n/index.svelte";
  import TitleBar from "./components/TitleBar.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import Home from "./components/Home.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Viewer from "./components/Viewer.svelte";
  import ChatPanel from "./components/ChatPanel.svelte";
  import Toasts from "./components/Toasts.svelte";
  import Dialogs from "./components/Dialogs.svelte";
  import FindBar from "./components/FindBar.svelte";
  import Icon from "./components/Icon.svelte";
  import Tooltips from "./components/Tooltips.svelte";

  const doc = $derived(activeDoc());
  let dropping = $state(false);
  // xterm loads, and the shell starts, only once the terminal is first opened; it then lives until the app quits.
  let terminalStarted = $state(false);
  $effect(() => {
    if (ui.terminal) terminalStarted = true;
  });

  const isImage = (p: string) => /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(p);

  onMount(() => {
    document.documentElement.lang = i18n.locale;
    const offs: Promise<() => void>[] = [];
    offs.push(listen<string>("menu", (e) => command(e.payload)));
    offs.push(listen<string[]>("open-files", (e) => openPaths(e.payload)));
    offs.push(
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") dropping = true;
        else if (e.payload.type === "leave") dropping = false;
        else if (e.payload.type === "drop") {
          dropping = false;
          const pdfs = e.payload.paths.filter((p) => /\.pdf$/i.test(p));
          const images = e.payload.paths.filter(isImage);
          if (pdfs.length) openPaths(pdfs);
          if (images.length) imagesToPdf(images);
        }
      }),
    );
    // Files the OS handed over at launch ("Open With", double-click).
    ipc.takeOpenedFiles().then((paths) => {
      if (paths.length) openPaths(paths);
    });
    initUpdates().catch(() => {});
    initShell().catch(() => {});
    if (settings.mcpEnabled) startMcp();
    else
      ipc.devAutostartMcp().then((on) => {
        if (on) startMcp();
      });
    return () => offs.forEach((o) => o.then((f) => f()));
  });

  // The window title follows the active document.
  $effect(() => {
    const title = doc ? `${doc.dirty ? "• " : ""}${doc.name} — KlikPaper` : "KlikPaper";
    getCurrentWindow().setTitle(title).catch(() => {});
  });

  function beforeUnload(e: BeforeUnloadEvent) {
    if (ws.docs.some((d) => d.dirty)) e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKeydown} onbeforeunload={beforeUnload} />

<div class="app">
  {#if ws.docs.length}
    <TitleBar />
  {/if}
  {#if doc}
    {#key doc.id}
      <Toolbar {doc} />
      <div class="main">
        {#if settings.showSidebar}
          <Sidebar {doc} />
        {/if}
        <div class="center">
          {#if ui.findOpen}
            <FindBar {doc} />
          {/if}
          <Viewer {doc} />
        </div>
        {#if settings.showChat}
          <ChatPanel {doc} />
        {/if}
      </div>
    {/key}
  {:else}
    <Home />
  {/if}
  {#if terminalStarted}
    {#await import("./components/TerminalPanel.svelte") then { default: TerminalPanel }}
      <TerminalPanel />
    {/await}
  {/if}

  {#if dropping}
    <div class="drop">
      <div class="drop-card"><Icon name="file" size={18} />{t("drop.hint")}</div>
    </div>
  {/if}
  {#if ui.busy}
    <div class="busy"><Icon name="loader" size={13} class="spin" />{ui.busy}</div>
  {/if}
  <Toasts />
  <Dialogs />
  <Tooltips />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .center {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .drop {
    position: fixed;
    inset: 8px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border: 2px dashed color-mix(in srgb, var(--accent) 70%, transparent);
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    pointer-events: none;
  }
  .drop-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 14px 20px;
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    font: 500 17px var(--serif);
    letter-spacing: -0.01em;
  }
  .drop-card :global(svg) {
    color: var(--accent);
  }
  .busy {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    background: var(--panel-2);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 12px;
    padding: 7px 14px;
    border-radius: 999px;
    display: flex;
    gap: 8px;
    align-items: center;
    z-index: 90;
    box-shadow: var(--shadow);
  }
  .busy :global(svg) {
    color: var(--accent);
  }
</style>
