<script lang="ts">
  // Plain interactive shell for running the user's agent next to KlikPaper; the user drives everything typed into it.
  import { onDestroy, onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { ipc, errorText } from "../lib/ipc";
  import { activeDoc } from "../lib/workspace.svelte";
  import { settings } from "../lib/settings.svelte";
  import { agentCommand } from "../lib/mcp.svelte";
  import { toast, ui } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // The folder of the active PDF, else the home folder (chosen on the Rust side).
  const docFolder = () => activeDoc()?.path?.replace(/[\\/][^\\/]*$/, "") ?? "";

  let host: HTMLDivElement;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let session: string | null = null;
  let cleanup: (() => void) | null = null;
  let exited = $state(false);
  let height = $state(260);
  // The shell keeps its folder when another tab is activated, so a running agent survives.
  let cwd = $state("");
  const command = $derived(agentCommand(settings.mcpClient));

  function start() {
    cleanup?.();
    const xterm = new Terminal({
      fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: "#15130f", foreground: "#ede6d8", cursor: "#f0a83a", cursorAccent: "#15130f", selectionBackground: "#f0a83a44" },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(host);
    // Let the app-level Ctrl+` toggle through instead of sending it to the shell.
    xterm.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.key === "`"));
    fitAddon.fit();
    term = xterm;
    fit = fitAddon;
    exited = false;
    cwd = docFolder();

    let disposed = false;
    ipc
      .terminalOpen(cwd, xterm.cols, xterm.rows, (e) => {
        if (e.type === "data") xterm.write(decode(e.data));
        else exited = true;
      })
      .then((id) => {
        if (disposed) ipc.terminalClose(id);
        else session = id;
      })
      .catch((e) => toast(errorText(e), "error"));
    const input = xterm.onData((d) => session && ipc.terminalWrite(session, d).catch(() => {}));
    const resize = xterm.onResize(({ cols, rows }) => session && ipc.terminalResize(session, cols, rows).catch(() => {}));
    const observer = new ResizeObserver(() => host.offsetParent && fitAddon.fit());
    observer.observe(host);

    cleanup = () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      resize.dispose();
      if (session) ipc.terminalClose(session);
      session = null;
      xterm.dispose();
      cleanup = null;
    };
  }

  onMount(start);
  onDestroy(() => cleanup?.());

  $effect(() => {
    void height;
    if (!ui.terminal) return;
    requestAnimationFrame(() => {
      fit?.fit();
      term?.focus();
    });
  });

  function runAgent() {
    if (!session || !command) return;
    // Only types the command: the user presses Enter and runs the agent themselves.
    ipc.terminalWrite(session, command).catch((e) => toast(errorText(e), "error"));
    term?.focus();
  }

  function startDrag(e: PointerEvent) {
    const startY = e.clientY;
    const start = height;
    const move = (ev: PointerEvent) => (height = Math.min(window.innerHeight * 0.7, Math.max(140, start + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
</script>

<section class="terminal" class:hidden={!ui.terminal} style:height="{height}px" aria-label={t("terminal.title")}>
  <div class="grip" role="separator" aria-orientation="horizontal" onpointerdown={startDrag}></div>
  <div class="head">
    <span class="title"><Icon name="terminal" size={14} />{t("terminal.title")}</span>
    <span class="cwd" title={cwd}>{cwd || "~"}</span>
    <div class="spacer"></div>
    {#if command}
      <button class="btn ghost small" onclick={runAgent} disabled={exited} title={t("terminal.runAgentHint", { command })}>
        <Icon name="sparkles" size={13} />{t("terminal.runAgent", { command })}
      </button>
    {/if}
    <button class="icon-btn" onclick={start} title={t("terminal.restart")} aria-label={t("terminal.restart")}><Icon name="rotate-ccw" size={14} /></button>
    <button class="icon-btn" onclick={() => (ui.terminal = false)} title={t("terminal.hide")} aria-label={t("terminal.hide")}><Icon name="down" /></button>
  </div>
  <div class="body">
    <div class="host" bind:this={host}></div>
    {#if exited}
      <div class="exited">{t("terminal.exited")}</div>
    {/if}
  </div>
</section>

<style>
  .terminal {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-top: 1px solid var(--line);
  }
  .terminal.hidden {
    display: none;
  }
  .grip {
    position: absolute;
    left: 0;
    right: 0;
    top: -4px;
    height: 8px;
    cursor: row-resize;
    z-index: 2;
  }
  .head {
    height: 34px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px 0 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    font-size: 12px;
    font-weight: 500;
  }
  .title :global(svg) {
    color: var(--muted);
  }
  .cwd {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font: 11px var(--mono);
  }
  .spacer {
    flex: 1;
  }
  .small {
    padding: 3px 9px;
    font-size: 12px;
    gap: 6px;
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 4px 8px 0;
    user-select: text;
  }
  .host {
    width: 100%;
    height: 100%;
  }
  .exited {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    text-align: center;
    font-size: 11px;
    color: var(--muted);
  }
</style>
