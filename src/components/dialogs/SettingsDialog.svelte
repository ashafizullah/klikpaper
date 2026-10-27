<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Dialog from "../Dialog.svelte";
  import Icon from "../Icon.svelte";
  import { ipc, errorText, type McpLink } from "../../lib/ipc";
  import { addProfile, persist, PROFILE_PRESETS, removeProfile, settings, type AiProfile } from "../../lib/settings.svelte";
  import { clientName, mcp, MCP_CLIENTS, setupSnippet, startMcp, stopMcp, type McpClientId } from "../../lib/mcp.svelte";
  import { isMac, openDialog, toast } from "../../lib/ui.svelte";
  import { checkForUpdates, installUpdate, setUpdateMode, updates } from "../../lib/updates.svelte";
  import { relabelShellMenu, setShellMenu, shellMenu } from "../../lib/shell.svelte";
  import type { UpdateMode } from "../../lib/settings.svelte";
  import { i18n, setLocale, t, type Key } from "../../lib/i18n/index.svelte";

  let { tab: initialTab = "general" }: { tab?: string } = $props();
  let tab = $state(untrack(() => initialTab));
  let version = $state("");
  let keyStatus = $state<Record<string, boolean>>({});
  let editing = $state<AiProfile | null>(null);
  let keyInput = $state("");
  let link = $state<McpLink | null>(null);
  let poll: ReturnType<typeof setInterval> | undefined;
  const client = $derived((MCP_CLIENTS.find((c) => c.id === settings.mcpClient) ?? MCP_CLIENTS[0]).id as McpClientId);
  const snippet = $derived(mcp.info ? setupSnippet(client, mcp.info) : "");

  onMount(async () => {
    version = await getVersion().catch(() => "");
    refreshKeys();
    poll = setInterval(async () => (link = settings.mcpEnabled ? await ipc.mcpLink().catch(() => null) : null), 1500);
  });
  onDestroy(() => clearInterval(poll));

  async function refreshKeys() {
    keyStatus = await ipc.keysStatus(settings.profiles.map((p) => p.id)).catch(() => ({}));
  }

  function newFromPreset(i: number) {
    const id = addProfile(PROFILE_PRESETS[i].profile);
    editing = settings.profiles.find((p) => p.id === id) ?? null;
    keyInput = "";
  }

  async function saveKey() {
    if (!editing) return;
    try {
      await ipc.setKey(editing.id, keyInput);
      keyInput = "";
      await refreshKeys();
      toast(t("settings.keySaved"), "ok");
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast(t("settings.copied"), "ok");
  }

  const TABS = [
    ["general", "settings.general"],
    ["ai", "settings.ai"],
    ["mcp", "settings.mcp"],
    ["about", "settings.about"],
  ] as const;
</script>

<Dialog title={t("settings.title")} width={620}>
  <nav class="tabs">
    {#each TABS as [id, label] (id)}
      <button class="tab" class:on={tab === id} onclick={() => (tab = id)}>{t(label)}</button>
    {/each}
  </nav>

  {#if tab === "general"}
    <label class="form-row">
      <span>{t("settings.language")}</span>
      <select class="field" value={i18n.locale} onchange={(e) => (setLocale(e.currentTarget.value as "en" | "id"), relabelShellMenu())}>
        <option value="en">English</option>
        <option value="id">Bahasa Indonesia</option>
      </select>
    </label>
    <label class="form-row">
      <span>{t("settings.updates")}</span>
      <select class="field" value={settings.updateMode} onchange={(e) => setUpdateMode(e.currentTarget.value as UpdateMode)}>
        <option value="auto">{t("settings.updateAuto")}</option>
        <option value="notify">{t("settings.updateNotify")}</option>
        <option value="off">{t("settings.updateOff")}</option>
      </select>
    </label>
    <div class="form-row">
      <span></span>
      <div class="update-actions">
        {#if updates.ready}
          <button class="btn primary" onclick={installUpdate}>{t("update.restart")}</button>
          <span class="muted">{t("update.ready", { version: updates.ready.version })}</span>
        {:else}
          <button class="btn" disabled={updates.checking} onclick={checkForUpdates}>{updates.checking ? t("update.checking") : t("settings.checkUpdates")}</button>
        {/if}
      </div>
    </div>
    <p class="note">{t(`settings.updateHint.${settings.updateMode}` as Key)}</p>
    {#if shellMenu.available}
      <div class="form-row">
        <span>{isMac ? "Finder" : "Explorer"}</span>
        <label class="row">
          <input type="checkbox" checked={settings.shellMenu} onchange={(e) => setShellMenu(e.currentTarget.checked)} />
          {t("settings.shellMenuToggle")}
        </label>
      </div>
      <p class="note">{t(isMac ? "settings.shellMenuHintMac" : "settings.shellMenuHint")}</p>
    {/if}
    <p class="note">{t("settings.privacy")}</p>
  {:else if tab === "ai"}
    <p class="note">{t("settings.aiIntro")}</p>
    <div class="profiles">
      {#each settings.profiles as p (p.id)}
        <div class="profile" class:on={editing?.id === p.id}>
          <button class="profile-main" onclick={() => ((editing = p), (keyInput = ""))}>
            <input type="radio" name="active" checked={settings.activeProfileId === p.id} onchange={() => ((settings.activeProfileId = p.id), persist())} onclick={(e) => e.stopPropagation()} aria-label={t("settings.useProfile")} />
            <span class="pname">{p.name}</span>
            <span class="muted">{p.model}</span>
            <span class="key" class:ok={keyStatus[p.id]}>{keyStatus[p.id] ? t("settings.hasKey") : t("settings.noKey")}</span>
          </button>
          <button class="icon-btn" onclick={() => ((editing = editing?.id === p.id ? null : editing), removeProfile(p.id))} aria-label={t("settings.removeProfile")} title={t("settings.removeProfile")}><Icon name="trash" /></button>
        </div>
      {/each}
    </div>
    <div class="choice">
      <select class="field" onchange={(e) => { if (e.currentTarget.value) newFromPreset(Number(e.currentTarget.value)); e.currentTarget.value = ""; }}>
        <option value="">{t("settings.addProfile")}</option>
        {#each PROFILE_PRESETS as preset, i (preset.label)}<option value={i}>{preset.label}</option>{/each}
      </select>
    </div>
    {#if editing}
      <div class="edit">
        <label class="form-row"><span>{t("settings.name")}</span><input class="field" bind:value={editing.name} onchange={persist} /></label>
        <label class="form-row">
          <span>{t("settings.format")}</span>
          <select class="field" bind:value={editing.format} onchange={persist}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </label>
        <label class="form-row"><span>{t("settings.baseUrl")}</span><input class="field" bind:value={editing.baseUrl} onchange={persist} spellcheck="false" /></label>
        <label class="form-row"><span>{t("settings.model")}</span><input class="field" bind:value={editing.model} onchange={persist} spellcheck="false" /></label>
        <div class="form-row">
          <span>{t("settings.apiKey")}</span>
          <div class="choice">
            <input class="field grow" type="password" bind:value={keyInput} placeholder={keyStatus[editing.id] ? "••••••••" : t("settings.pasteKey")} autocomplete="off" />
            <button class="btn" disabled={!keyInput.trim()} onclick={saveKey}>{t("common.save")}</button>
            {#if keyStatus[editing.id]}<button class="btn danger" onclick={async () => { await ipc.deleteKey(editing!.id); refreshKeys(); }}>{t("settings.forgetKey")}</button>{/if}
          </div>
        </div>
        <p class="note">{t("settings.keyNote")}</p>
      </div>
    {/if}
  {:else if tab === "mcp"}
    <p class="note">{t("settings.mcpIntro")}</p>
    <label class="row">
      <input type="checkbox" checked={settings.mcpEnabled} onchange={(e) => (e.currentTarget.checked ? startMcp() : stopMcp())} />
      {t("settings.mcpEnable")}
    </label>
    {#if mcp.error}<p class="error-text">{mcp.error}</p>{/if}
    {#if settings.mcpEnabled && mcp.info}
      <div class="clients" role="radiogroup" aria-label={t("settings.mcpClient")}>
        {#each MCP_CLIENTS as c (c.id)}
          <button class="client" class:on={client === c.id} role="radio" aria-checked={client === c.id} onclick={() => ((settings.mcpClient = c.id), persist())}>
            {c.id === "other" ? t("settings.mcpOther") : c.label}
          </button>
        {/each}
      </div>
      <p class="note">{t(`settings.mcpStep.${client}` as Key)}</p>
      <div class="cmd selectable">
        <code>{snippet}</code>
        <button class="icon-btn" onclick={() => copy(snippet)} title={t("settings.copy")} aria-label={t("settings.copy")}><Icon name="duplicate" /></button>
      </div>
      <p class="status" class:ok={link?.connected}>
        <span class="dot"></span>
        {link?.connected ? t("settings.mcpConnected", { client: link.client ?? clientName(null) }) : t("settings.mcpWaiting")}
      </p>
      <p class="note">{t("settings.mcpSafety")}</p>
    {/if}
  {:else}
    <div class="about">
      <img src="/icon.png" alt="" width="64" height="64" />
      <div>
        <h3>KlikPaper {version}</h3>
        <p class="note">{t("about.body")}</p>
      </div>
    </div>
    <p class="note">{t("about.builtOn")}</p>
    <div class="choice">
      <button class="btn" onclick={() => openUrl("https://github.com/ashafizullah/klikpaper")}><Icon name="external" />GitHub</button>
      <button class="btn" onclick={() => openDialog("licenses")}>{t("about.licenses")}</button>
      <button class="btn" disabled={updates.checking} onclick={checkForUpdates}>{updates.checking ? t("update.checking") : t("settings.checkUpdates")}</button>
    </div>
    <p class="note">{t("about.ai")}</p>
  {/if}
</Dialog>

<style>
  .update-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--border);
    margin: -16px -16px 4px;
    padding: 0 12px;
  }
  .tab {
    border: none;
    background: none;
    padding: 8px 10px;
    border-bottom: 2px solid transparent;
    color: var(--muted);
  }
  .tab.on {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .profiles {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .profile {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .profile.on {
    border-color: var(--accent);
  }
  .profile-main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: none;
    background: none;
    text-align: left;
    min-width: 0;
  }
  .pname {
    font-weight: 600;
  }
  .key {
    margin-left: auto;
    font-size: 11px;
    color: var(--danger);
  }
  .key.ok {
    color: var(--ok);
  }
  .edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--bg);
    border-radius: 8px;
  }
  .grow {
    flex: 1;
  }
  .cmd {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 6px 6px 10px;
  }
  .cmd code {
    flex: 1;
    font: 11px/1.4 var(--mono);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .clients {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .client {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: none;
    color: var(--muted);
    font-size: 12px;
  }
  .client.on {
    border-color: var(--accent);
    color: var(--text);
    font-weight: 600;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--muted);
  }
  .status .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .status.ok {
    color: var(--ok);
  }
  .status.ok .dot {
    background: var(--ok);
  }
  .about {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .about h3 {
    margin: 0 0 4px;
    font-family: var(--serif);
  }
</style>
