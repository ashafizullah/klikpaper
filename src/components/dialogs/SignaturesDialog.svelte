<script lang="ts">
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import type { SignatureReport } from "../../lib/ipc";
  import { closeDialog } from "../../lib/ui.svelte";
  import { viewer } from "../../lib/viewer.svelte";
  import { t } from "../../lib/i18n/index.svelte";
  import Icon from "../Icon.svelte";

  let { doc }: { doc: Doc } = $props();

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);
  const day = (iso: string) => new Date(iso).toLocaleDateString();

  /** The one-line verdict of a signature. */
  function verdict(s: SignatureReport): { tone: "ok" | "warn" | "bad" | "muted"; text: string } {
    if (s.status === "unknown") return { tone: "muted", text: t("sig.unknown") };
    if (s.status === "invalid") return { tone: "bad", text: s.intact === false ? t("sig.changed") : t("sig.broken") };
    return s.coversAll ? { tone: "ok", text: t("sig.valid") } : { tone: "warn", text: t("sig.validEarlier") };
  }

  function goTo(page: number) {
    const i = doc.pages.findIndex((p) => p.index === page);
    if (i >= 0) viewer.goTo(i, true);
    closeDialog(null);
  }
</script>

<Dialog title={t("sig.title")} width={540}>
  <div class="list selectable">
    {#each doc.signatures as s, i (i)}
      {@const v = verdict(s)}
      <section class="card">
        <header class={v.tone}>
          <Icon name={v.tone === "ok" ? "shield" : "alert"} size={15} />
          <strong>{s.timestamp ? t("sig.timestamp") : (s.signer?.name ?? s.name ?? t("sig.unnamed"))}</strong>
        </header>
        <p class="verdict">{v.text}</p>
        <dl>
          {#if s.signer?.organization}<dt>{t("sig.organization")}</dt><dd>{s.signer.organization}</dd>{/if}
          {#if s.name && s.name !== s.signer?.name}<dt>{t("sig.nameInSignature")}</dt><dd>{s.name}</dd>{/if}
          {#if s.signedAt}<dt>{t("sig.signedAt")}</dt><dd>{date(s.signedAt)}</dd>{/if}
          {#if s.reason}<dt>{t("sig.reason")}</dt><dd>{s.reason}</dd>{/if}
          {#if s.location}<dt>{t("sig.location")}</dt><dd>{s.location}</dd>{/if}
          {#if s.signer}
            <dt>{t("sig.issuer")}</dt>
            <dd>{s.signer.issuer}{s.signer.issuerOrganization ? ` (${s.signer.issuerOrganization})` : ""}</dd>
            <dt>{t("sig.validity")}</dt>
            <dd>{day(s.signer.validFrom)} – {day(s.signer.validTo)}</dd>
          {/if}
          {#if s.page != null}<dt>{t("sig.page")}</dt><dd><button class="link" onclick={() => goTo(s.page!)}>{t("pages.page", { n: s.page + 1 })}</button></dd>{/if}
        </dl>
        {#if s.signer?.selfSigned}<p class="warn">{t("sig.selfSigned")}</p>{/if}
        {#if s.certValidWhenSigned === false}<p class="warn">{t("sig.certExpired")}</p>{/if}
        {#if s.problem}<p class="muted small">{t("sig.problem", { problem: s.problem })}</p>{/if}
      </section>
    {/each}
  </div>
  <p class="note muted">{t("sig.limits")}</p>
  <p class="note muted">{t("sig.saving")}</p>
  {#snippet footer()}
    <button class="btn primary" onclick={() => closeDialog(null)}>{t("common.ok")}</button>
  {/snippet}
</Dialog>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 55vh;
    overflow-y: auto;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  header.ok {
    color: var(--ok);
  }
  header.warn {
    color: var(--accent);
  }
  header.bad {
    color: var(--danger);
  }
  header.muted {
    color: var(--muted);
  }
  header strong {
    color: var(--text);
  }
  .verdict {
    margin: 6px 0 8px;
    font-size: 12.5px;
  }
  dl {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 4px 12px;
    margin: 0;
    font-size: 12px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .warn {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--accent);
  }
  .small {
    margin: 8px 0 0;
    font-size: 11.5px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font-size: 12px;
  }
</style>
