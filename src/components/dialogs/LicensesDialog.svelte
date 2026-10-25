<script lang="ts">
  import Dialog from "../Dialog.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let notices = $state("…");
  fetch("/THIRD_PARTY_NOTICES.md")
    .then((r) => r.text())
    .then((text) => (notices = text))
    .catch(() => (notices = "https://github.com/ashafizullah/klikpaper/blob/main/THIRD_PARTY_NOTICES.md"));
</script>

<Dialog title={t("about.licenses")} width={680}>
  <p class="note">{t("licenses.intro")}</p>
  <pre class="selectable">{notices}</pre>
</Dialog>

<style>
  pre {
    font: 11px/1.45 var(--mono);
    white-space: pre-wrap;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    margin: 0;
    max-height: 60vh;
    overflow: auto;
  }
</style>
