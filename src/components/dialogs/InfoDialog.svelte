<script lang="ts">
  import { onMount } from "svelte";
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { errorText, ipc, type PdfInfo } from "../../lib/ipc";
  import { formatBytes } from "../../lib/pagespec";
  import { t, type Key } from "../../lib/i18n/index.svelte";
  import { summarize } from "../../lib/signatures";

  let { doc }: { doc: Doc } = $props();
  let info = $state<PdfInfo | null>(null);
  let error = $state<string | null>(null);
  onMount(() => {
    const source = doc.sources.values().next().value;
    if (doc.path) ipc.pdfInfo(doc.path, source?.password ?? null).then((i) => (info = i)).catch((e) => (error = errorText(e)));
  });

  /** PDF dates look like D:20240131120000+07'00'. */
  function date(s: string | null): string | null {
    const m = s && /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
    if (!m) return s;
    const d = new Date(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0));
    return d.toLocaleString();
  }

  const summary = $derived(summarize(doc.signatures));
  const signed = $derived(summary ? `${doc.signatures.length} · ${t(`sig.badge.${summary}` as Key)}` : null);
  const sizes = $derived([...new Set(doc.pages.map((p) => `${Math.round(((p.sheet?.w ?? p.w) / 72) * 25.4)} × ${Math.round(((p.sheet?.h ?? p.h) / 72) * 25.4)} mm`))]);
  const rows = $derived<[string, string | null | undefined][]>([
    [t("info.file"), doc.path ?? t("info.unsaved")],
    [t("info.pages"), String(doc.pages.length)],
    [t("info.pageSize"), sizes.slice(0, 3).join(", ") + (sizes.length > 3 ? "…" : "")],
    [t("info.fileSize"), info ? formatBytes(info.bytes) : null],
    [t("info.version"), info?.version],
    [t("info.encrypted"), info ? (info.encrypted ? t("common.yes") : t("common.no")) : null],
    [t("info.title"), info?.title],
    [t("info.author"), info?.author],
    [t("info.subject"), info?.subject],
    [t("info.keywords"), info?.keywords],
    [t("info.creator"), info?.creator],
    [t("info.producer"), info?.producer],
    [t("info.created"), date(info?.created ?? null)],
    [t("info.modified"), date(info?.modified ?? null)],
    [t("info.redacted"), info?.redacted],
    [t("info.history"), info?.history],
    [t("info.signatures"), signed],
  ]);
</script>

<Dialog title={t("info.heading")} width={520}>
  <dl class="selectable">
    {#each rows as [k, v] (k)}
      {#if v}<dt>{k}</dt><dd>{v}</dd>{/if}
    {/each}
  </dl>
  {#if error}<p class="error-text">{error}</p>{/if}
  {#if doc.dirty}<p class="note">{t("info.dirty")}</p>{/if}
</Dialog>

<style>
  dl {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 6px 12px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    word-break: break-all;
    /* The edit history has one line per save. */
    white-space: pre-line;
  }
</style>
