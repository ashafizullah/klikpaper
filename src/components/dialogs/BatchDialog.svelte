<script lang="ts">
  import { onDestroy } from "svelte";
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import Dialog from "../Dialog.svelte";
  import { runBatch, writesFiles, type BatchActions, type BatchProgress, type BatchReport } from "../../lib/batch";
  import { errorText, ipc, type CompressLevel } from "../../lib/ipc";
  import { baseName, dirName, formatBytes } from "../../lib/pagespec";
  import { PII_KINDS, type PiiKind } from "../../lib/pii";
  import { closeDialog } from "../../lib/ui.svelte";
  import { PDF_FILTER } from "../../lib/workspace.svelte";
  import { t, type Key } from "../../lib/i18n/index.svelte";
  import Icon from "../Icon.svelte";

  let { files: initial = [] }: { files?: string[] } = $props();
  // svelte-ignore state_referenced_locally
  let files = $state<string[]>([...initial]);
  let outDir = $state<string | null>(null);
  let suffix = $state(t("batch.suffixDefault"));

  let clean = $state(false);
  let cleanBw = $state(true);
  let ocr = $state(false);
  let personal = $state(false);
  let kinds = $state<PiiKind[]>([...PII_KINDS]);
  let watermark = $state(false);
  let watermarkText = $state(t("watermark.default"));
  let numbers = $state(false);
  let numberFormat = $state("{n}");
  let compress = $state(false);
  let level = $state<CompressLevel>("medium");
  let lock = $state(false);
  let password = $state("");
  let strip = $state(false);
  let signatures = $state(false);

  let progress = $state<BatchProgress | null>(null);
  let reports = $state<BatchReport[] | null>(null);
  let error = $state<string | null>(null);
  let cancelled = false;
  onDestroy(() => (cancelled = true));

  const actions = $derived<BatchActions>({
    cleanup: clean ? { deskew: true, borders: true, blackWhite: cleanBw } : null,
    ocr,
    personal: personal && kinds.length ? kinds : null,
    watermark: watermark && watermarkText.trim() ? { text: watermarkText.trim(), size: 64, opacity: 0.18, color: "#7a7a7a", angle: 45 } : null,
    pageNumbers: numbers && numberFormat.trim() ? { format: numberFormat, position: "bottom-center", start: 1, size: 10, margin: 28, color: "#1b1916" } : null,
    compress: compress ? level : null,
    password: lock && password ? password : null,
    stripMetadata: strip,
    checkSignatures: signatures,
  });
  const writes = $derived(writesFiles(actions));
  const ready = $derived(files.length > 0 && (writes ? !!outDir : signatures) && !(lock && !password));

  async function addFiles() {
    const picked = await openFileDialog({ multiple: true, filters: PDF_FILTER });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    files = [...new Set([...files, ...list])];
    outDir ??= list[0] ? dirName(list[0]) : null;
  }

  async function addFolder() {
    const dir = await openFileDialog({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    try {
      const found = await ipc.listPdfs(dir);
      files = [...new Set([...files, ...found])];
      outDir ??= dir;
      if (!found.length) error = t("batch.emptyFolder");
    } catch (e) {
      error = errorText(e);
    }
  }

  async function pickOut() {
    const dir = await openFileDialog({ directory: true, multiple: false });
    if (dir && !Array.isArray(dir)) outDir = dir;
  }

  async function run() {
    error = null;
    cancelled = false;
    try {
      reports = await runBatch(files, actions, outDir ?? "", suffix.trim(), (p) => (progress = p), () => cancelled);
    } catch (e) {
      error = errorText(e);
    } finally {
      progress = null;
    }
  }

  const stageLabel = (s: string) => t(`batch.stage.${s}` as Key);
  const firstOutput = $derived(reports?.find((r) => r.output)?.output ?? null);

  /** Notes on one file's result, in plain words. */
  function notes(r: BatchReport): string[] {
    const out: string[] = [];
    if (r.cleaned) out.push(t("batch.noteClean", { n: r.cleaned }));
    if (r.ocrPages) out.push(t("batch.noteOcr", { n: r.ocrPages }));
    const blacked = Object.values(r.personal).reduce((a, b) => a + (b ?? 0), 0);
    if (actions.personal) out.push(blacked ? t("batch.notePersonal", { n: blacked }) : t("batch.notePersonalNone"));
    if (r.pictures) out.push(t("batch.notePictures", { n: r.pictures }));
    if (r.signatures) out.push(t(`sig.badge.${r.signatures}` as Key) + (r.output ? ` · ${t("batch.noteSignatureBroken")}` : ""));
    else if (actions.checkSignatures) out.push(t("batch.noteUnsigned"));
    return out;
  }
</script>

<Dialog title={t("batch.title")} width={640}>
  {#if reports}
    <p class="note">{t("batch.finished", { ok: reports.filter((r) => !r.error).length, n: reports.length })}</p>
    <div class="table selectable">
      {#each reports as r (r.input)}
        <div class="row" class:failed={!!r.error}>
          <Icon name={r.error ? "alert" : "check"} size={14} />
          <div class="file">
            <strong>{baseName(r.input)}</strong>
            {#if r.error}
              <span class="err">{r.error === "password" ? t("batch.needsPassword") : r.error}</span>
            {:else}
              <span class="muted">
                {r.pages} {t("batch.pages")}{#if r.bytesAfter != null} · {formatBytes(r.bytesBefore)} → {formatBytes(r.bytesAfter)}{/if}
                {#if r.output} · {baseName(r.output)}{/if}
              </span>
              {#each notes(r) as n (n)}<span class="small">{n}</span>{/each}
            {/if}
          </div>
        </div>
      {/each}
    </div>
    {#if actions.personal}<p class="note muted">{t("batch.reviewPersonal")}</p>{/if}
  {:else}
    <section>
      <div class="head">
        <span class="label section">{t("batch.files", { n: files.length })}</span>
        <span class="buttons">
          <button class="btn" onclick={addFiles} disabled={!!progress}><Icon name="files" size={14} />{t("batch.addFiles")}</button>
          <button class="btn" onclick={addFolder} disabled={!!progress}><Icon name="folder" size={14} />{t("batch.addFolder")}</button>
          {#if files.length}<button class="btn" onclick={() => (files = [])} disabled={!!progress}>{t("batch.clear")}</button>{/if}
        </span>
      </div>
      {#if files.length}
        <ul class="files">
          {#each files as f (f)}<li title={f}>{baseName(f)}</li>{/each}
        </ul>
      {/if}
    </section>

    <section class="actions">
      <span class="label section">{t("batch.steps")}</span>
      <label class="row"><input type="checkbox" bind:checked={clean} />{t("batch.clean")}</label>
      {#if clean}
        <div class="sub">
          <label class="row"><input type="checkbox" bind:checked={cleanBw} />{t("clean.blackWhite")}</label>
          <p class="hint">{t("clean.blackWhiteHint")}</p>
        </div>
      {/if}
      <label class="row"><input type="checkbox" bind:checked={ocr} />{t("batch.ocr")}</label>
      <label class="row"><input type="checkbox" bind:checked={personal} />{t("batch.personal")}</label>
      {#if personal}
        <div class="sub">
          <div class="kinds">
            {#each PII_KINDS as k (k)}
              <label class="row"><input type="checkbox" bind:group={kinds} value={k} />{t(`pii.${k}` as Key)}</label>
            {/each}
          </div>
          <p class="warn">{t("batch.personalWarn")}</p>
        </div>
      {/if}
      <label class="row"><input type="checkbox" bind:checked={watermark} />{t("batch.watermark")}</label>
      {#if watermark}<div class="sub"><input class="field" bind:value={watermarkText} aria-label={t("batch.watermark")} /></div>{/if}
      <label class="row"><input type="checkbox" bind:checked={numbers} />{t("batch.pageNumbers")}</label>
      {#if numbers}
        <div class="sub">
          <select class="field" bind:value={numberFormat} aria-label={t("batch.pageNumbers")}>
            <option value={"{n}"}>1, 2, 3…</option>
            <option value={"{n} / {total}"}>1 / 10</option>
            <option value={t("batch.pageOf")}>{t("batch.pageOf").replace("{n}", "1").replace("{total}", "10")}</option>
          </select>
        </div>
      {/if}
      <label class="row"><input type="checkbox" bind:checked={compress} />{t("batch.compress")}</label>
      {#if compress}
        <div class="sub">
          <select class="field" bind:value={level} aria-label={t("batch.compress")}>
            <option value="low">{t("batch.compressLow")}</option>
            <option value="medium">{t("batch.compressMedium")}</option>
            <option value="high">{t("batch.compressHigh")}</option>
          </select>
        </div>
      {/if}
      <label class="row"><input type="checkbox" bind:checked={lock} />{t("batch.password")}</label>
      {#if lock}<div class="sub"><input class="field" type="password" bind:value={password} placeholder={t("batch.passwordHint")} aria-label={t("batch.password")} /></div>{/if}
      <label class="row"><input type="checkbox" bind:checked={strip} />{t("security.strip")}</label>
      <label class="row"><input type="checkbox" bind:checked={signatures} />{t("batch.signatures")}</label>
    </section>

    {#if writes}
      <section>
        <span class="label section">{t("batch.output")}</span>
        <div class="out">
          <button class="btn" onclick={pickOut} disabled={!!progress}><Icon name="folder" size={14} />{t("batch.pickFolder")}</button>
          <span class="path" title={outDir ?? ""}>{outDir ?? t("batch.noFolder")}</span>
        </div>
        <label class="form-row"><span>{t("batch.suffix")}</span><input class="field" bind:value={suffix} /></label>
        <p class="note muted">{t("batch.never")}</p>
      </section>
    {/if}

    {#if progress}
      <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <div class="bar" style:width="{(progress.done / Math.max(1, progress.total)) * 100}%"></div>
      </div>
      <p class="note">{t("batch.progress", { i: Math.min(progress.done + 1, progress.total), n: progress.total, file: baseName(progress.file) })} · {stageLabel(progress.stage)}</p>
    {/if}
  {/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  {#snippet footer()}
    {#if reports}
      {#if firstOutput}<button class="btn" onclick={() => revealItemInDir(firstOutput)}><Icon name="folder" size={14} />{t("common.showInFolder")}</button>{/if}
      <button class="btn primary" onclick={() => closeDialog(reports)}>{t("common.ok")}</button>
    {:else}
      <button
        class="btn"
        onclick={() => {
          cancelled = true;
          if (!progress) closeDialog(null);
        }}>{t("common.cancel")}</button
      >
      <button class="btn primary" disabled={!ready || !!progress} onclick={run}>{t(!writes && signatures ? "batch.check" : "batch.run", { n: files.length })}</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 6px 8px;
    max-height: 110px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    font-size: 12px;
  }
  .files li {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions .row {
    font-size: 12.5px;
  }
  .sub {
    margin-left: 24px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .kinds {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 2px 12px;
    font-size: 12px;
  }
  .hint {
    margin: 0;
    font-size: 11.5px;
    color: var(--muted);
  }
  .warn {
    margin: 0;
    font-size: 11.5px;
    color: var(--accent);
  }
  .out {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 11.5px var(--mono);
    color: var(--muted);
  }
  .progress {
    height: 6px;
    border-radius: 999px;
    background: var(--line);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .table {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 50vh;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 4px;
  }
  .table .row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px;
    color: var(--ok);
  }
  .table .row.failed {
    color: var(--danger);
  }
  .file {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    color: var(--text);
    font-size: 12.5px;
  }
  .file strong {
    font-weight: 500;
  }
  .err {
    color: var(--danger);
    font-size: 12px;
  }
  .small {
    font-size: 11.5px;
    color: var(--muted);
  }
</style>
