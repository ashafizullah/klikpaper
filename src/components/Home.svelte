<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { command, imagesToPdf } from "../lib/commands.svelte";
  import { openPaths } from "../lib/workspace.svelte";
  import { removeRecent, settings } from "../lib/settings.svelte";
  import { baseName, dirName, formatBytes } from "../lib/pagespec";
  import { ipc, type FileStat } from "../lib/ipc";
  import { recentPreview } from "../lib/recent";
  import { isMac, mod, openDialog } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";
  import LanguageToggle from "./LanguageToggle.svelte";

  let version = $state("");
  let checking = $state(false);
  let stats = $state<Record<string, FileStat>>({});
  let previews = $state<Record<string, string | null>>({});

  onMount(() => {
    getVersion()
      .then((v) => (version = v))
      .catch(() => {});
  });

  // Sizes, missing files and first-page previews for the recent list.
  $effect(() => {
    const paths = settings.recent.slice();
    if (!paths.length) return;
    let live = true;
    ipc
      .fileStats(paths)
      .then((list) => {
        if (!live) return;
        stats = Object.fromEntries(list.map((s) => [s.path, s]));
        for (const s of list) {
          recentPreview(s).then((url) => {
            if (live) previews[s.path] = url;
          });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  async function checkUpdates() {
    checking = true;
    try {
      await ipc.checkUpdates();
    } finally {
      checking = false;
    }
  }

  const TOOLS = [
    { icon: "open", label: "home.open", hint: `${mod}O`, run: () => command("open") },
    { icon: "merge", label: "home.merge", hint: "home.mergeHint", run: () => command("merge") },
    { icon: "images", label: "home.images", hint: "home.imagesHint", run: () => imagesToPdf() },
  ] as const;
</script>

<div class="home">
  <aside>
    {#if isMac}<div class="traffic" data-tauri-drag-region></div>{/if}
    <div class="brand" data-tauri-drag-region>
      <img src="/icon.png" alt="" width="32" height="32" draggable="false" />
      <span class="wordmark">Klik<em>Paper</em></span>
    </div>

    <span class="label section">{t("home.start")}</span>
    <nav>
      {#each TOOLS as tool (tool.label)}
        <button class="nav-item" onclick={tool.run}>
          <Icon name={tool.icon} size={15} />
          <span class="nav-text">
            <span>{t(tool.label)}</span>
            <span class="nav-hint">{tool.hint.startsWith("home.") ? t(tool.hint as "home.mergeHint") : tool.hint}</span>
          </span>
        </button>
      {/each}
    </nav>

    <span class="label section">{t("home.extras")}</span>
    <nav>
      <button class="nav-item" onclick={() => openDialog("settings", { tab: "ai" })}>
        <Icon name="sparkles" size={15} />
        <span class="nav-text">
          <span>{t("ai.title")}</span>
          <span class="nav-hint">{t("home.aiHint")}</span>
        </span>
      </button>
      <button class="nav-item" onclick={() => openDialog("settings", { tab: "mcp" })}>
        <Icon name="plug" size={15} />
        <span class="nav-text">
          <span>{t("settings.mcp")}</span>
          <span class="nav-hint">{t("home.mcpHint")}</span>
        </span>
      </button>
    </nav>

    <div class="grow"></div>
    <p class="privacy"><Icon name="shield" size={13} /><span>{t("home.privacy")}</span></p>
    <div class="foot">
      <button class="btn ghost settings" onclick={() => command("settings")}><Icon name="settings" size={14} />{t("settings.title")}</button>
      <LanguageToggle />
    </div>
    <button class="version" onclick={checkUpdates} disabled={checking} title={t("settings.checkUpdates")}>
      <span>KlikPaper {version && `v${version}`}</span>
      <span class="check"><Icon name="refresh" size={10} class={checking ? "spin" : ""} />{t("settings.checkUpdates")}</span>
    </button>
  </aside>

  <main>
    <header data-tauri-drag-region>
      <div class="titles" data-tauri-drag-region>
        <h1>{t("home.title")}</h1>
        <p class="sub">{t("home.tagline")}</p>
      </div>
      <button class="btn primary" onclick={() => command("open")}><Icon name="open" size={14} />{t("home.open")}</button>
    </header>

    <div class="body">
      <section class="hero rise">
        <div class="hero-icon"><Icon name="file" size={22} /></div>
        <div class="hero-text">
          <h2>{t("home.heroTitle")}</h2>
          <p>{t("home.drop")}</p>
        </div>
        <div class="hero-actions">
          <button class="btn" onclick={() => command("merge")}><Icon name="merge" size={14} />{t("home.merge")}</button>
          <button class="btn" onclick={() => imagesToPdf()}><Icon name="images" size={14} />{t("home.images")}</button>
        </div>
      </section>

      <section>
        <h2 class="label">{t("home.recent")}</h2>
        {#if settings.recent.length}
          <div class="grid">
            {#each settings.recent as path, i (path)}
              {@const stat = stats[path]}
              {@const missing = stat && !stat.exists}
              <div class="card rise" class:missing style:animation-delay="{Math.min(i, 12) * 40}ms">
                <button class="card-main" onclick={() => openPaths([path])} title={path} disabled={missing}>
                  <div class="preview">
                    {#if previews[path]}
                      <img src={previews[path]} alt="" draggable="false" />
                    {:else}
                      <div class="sheet"></div>
                    {/if}
                  </div>
                  <div class="meta">
                    <div class="name">{baseName(path)}</div>
                    <div class="dir">
                      <span class="path">{missing ? t("home.missing") : dirName(path)}</span>
                      {#if stat?.exists}<span class="size">{formatBytes(stat.bytes)}</span>{/if}
                    </div>
                  </div>
                </button>
                <button class="forget" onclick={() => removeRecent(path)} title={t("home.forget")} aria-label={t("home.forget")}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty">
            <Icon name="files" size={32} stroke={1.5} />
            <p>{t("home.recentEmpty")}</p>
          </div>
        {/if}
      </section>
    </div>
  </main>
</div>

<style>
  .home {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* ---- sidebar ---- */
  aside {
    width: 256px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-right: 1px solid var(--line);
  }
  .traffic {
    height: 30px;
    flex: none;
  }
  .brand {
    height: 56px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 16px;
    border-bottom: 1px solid var(--line);
  }
  .brand img {
    border-radius: 7px;
  }
  .wordmark {
    font: 500 18px var(--serif);
    letter-spacing: -0.02em;
  }
  .wordmark em {
    color: var(--accent);
  }
  .section {
    padding: 16px 16px 4px;
    margin: 0;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px;
  }
  .nav-item {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 8px;
    border: none;
    border-radius: 6px;
    background: none;
    text-align: left;
    color: var(--muted);
    transition:
      background 0.15s,
      color 0.15s;
  }
  .nav-item :global(svg) {
    margin-top: 1px;
    flex: none;
  }
  .nav-item:hover {
    background: color-mix(in srgb, var(--panel-2) 70%, transparent);
    color: var(--accent);
  }
  .nav-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 12px;
    color: var(--text);
  }
  .nav-hint {
    font-size: 10.5px;
    color: var(--muted);
  }
  .grow {
    flex: 1;
  }
  .privacy {
    display: flex;
    gap: 7px;
    margin: 0 12px 10px;
    padding: 9px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--ok) 8%, transparent);
    color: var(--muted);
    font-size: 10.5px;
    line-height: 1.45;
  }
  .privacy :global(svg) {
    color: var(--ok);
    flex: none;
    margin-top: 1px;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-top: 1px solid var(--line);
  }
  .settings {
    flex: 1;
    justify-content: flex-start;
  }
  .version {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 12px;
    border: none;
    border-top: 1px solid var(--line);
    background: none;
    color: var(--muted);
    font-size: 10px;
  }
  .version:hover {
    color: var(--text);
  }
  .version:disabled {
    opacity: 0.6;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* ---- main ---- */
  main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    height: 64px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 24px;
    border-bottom: 1px solid var(--line);
  }
  .titles {
    min-width: 0;
  }
  h1 {
    margin: 0;
    font: 500 20px var(--serif);
    letter-spacing: -0.015em;
  }
  .sub {
    margin: 0;
    font: 10.5px var(--mono);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .hero {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: linear-gradient(
      to bottom right,
      color-mix(in srgb, var(--accent) 15%, transparent),
      var(--panel) 50%,
      color-mix(in srgb, var(--accent-2) 10%, transparent)
    );
  }
  .hero-icon {
    width: 44px;
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }
  .hero-text {
    flex: 1;
    min-width: 0;
  }
  .hero h2 {
    margin: 0;
    font: 500 20px var(--serif);
    letter-spacing: -0.015em;
  }
  .hero p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .hero-actions {
    display: flex;
    gap: 8px;
    flex: none;
  }

  section h2.label {
    margin-bottom: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 16px;
  }
  .card {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    transition:
      border-color 0.2s,
      transform 0.2s,
      box-shadow 0.2s;
  }
  .card:hover:not(.missing) {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent) 70%, transparent);
    box-shadow: var(--shadow);
  }
  .card.missing {
    opacity: 0.55;
  }
  .card-main {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
  }
  .card-main:disabled {
    cursor: default;
  }
  .preview {
    aspect-ratio: 4 / 3.4;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px;
    background-color: #13110d;
    background-image: radial-gradient(#2a251d 1px, transparent 1px);
    background-size: 18px 18px;
  }
  .preview img {
    max-width: 100%;
    max-height: 100%;
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.5);
  }
  .sheet {
    height: 100%;
    aspect-ratio: 1 / 1.414;
    background: #f4efe4;
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.5);
  }
  .meta {
    padding: 10px 12px 12px;
  }
  .name {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dir {
    display: flex;
    gap: 8px;
    margin-top: 3px;
    font: 10.5px var(--mono);
    color: var(--muted);
    white-space: nowrap;
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }
  .size {
    flex: none;
  }
  .forget {
    position: absolute;
    top: 8px;
    right: 8px;
    display: none;
    padding: 5px;
    border: none;
    border-radius: 6px;
    background: rgb(0 0 0 / 0.6);
    color: var(--muted);
    line-height: 0;
  }
  .card:hover .forget {
    display: block;
  }
  .forget:hover {
    color: var(--danger);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 48px 0;
    color: var(--muted);
    font-size: 12px;
  }
  .empty p {
    margin: 0;
  }
</style>
