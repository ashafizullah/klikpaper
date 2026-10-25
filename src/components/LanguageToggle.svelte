<script lang="ts">
  import { i18n, setLocale, type Locale } from "../lib/i18n/index.svelte";

  const LOCALES: { id: Locale; label: string }[] = [
    { id: "en", label: "EN" },
    { id: "id", label: "ID" },
  ];
</script>

<div class="segmented" role="group" aria-label="Language">
  {#each LOCALES as l (l.id)}
    <button class:on={i18n.locale === l.id} onclick={() => setLocale(l.id)} aria-pressed={i18n.locale === l.id}>{l.label}</button>
  {/each}
</div>
