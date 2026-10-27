<script lang="ts">
  import type { Component } from "svelte";
  import { ui } from "../lib/ui.svelte";
  import PasswordDialog from "./dialogs/PasswordDialog.svelte";
  import UnsavedDialog from "./dialogs/UnsavedDialog.svelte";
  import SettingsDialog from "./dialogs/SettingsDialog.svelte";
  import LicensesDialog from "./dialogs/LicensesDialog.svelte";
  import CompressDialog from "./dialogs/CompressDialog.svelte";
  import SplitDialog from "./dialogs/SplitDialog.svelte";
  import ExportImagesDialog from "./dialogs/ExportImagesDialog.svelte";
  import SecurityDialog from "./dialogs/SecurityDialog.svelte";
  import WatermarkDialog from "./dialogs/WatermarkDialog.svelte";
  import PageNumbersDialog from "./dialogs/PageNumbersDialog.svelte";
  import InfoDialog from "./dialogs/InfoDialog.svelte";
  import ImagesDialog from "./dialogs/ImagesDialog.svelte";
  import SignatureDialog from "./dialogs/SignatureDialog.svelte";
  import AlertDialog from "./dialogs/AlertDialog.svelte";

  const KINDS: Record<string, Component<any>> = {
    password: PasswordDialog,
    unsaved: UnsavedDialog,
    settings: SettingsDialog,
    licenses: LicensesDialog,
    compress: CompressDialog,
    split: SplitDialog,
    "export-images": ExportImagesDialog,
    security: SecurityDialog,
    watermark: WatermarkDialog,
    "page-numbers": PageNumbersDialog,
    info: InfoDialog,
    images: ImagesDialog,
    signature: SignatureDialog,
    alert: AlertDialog,
  };
</script>

{#each ui.dialogs as d, i (i)}
  {@const C = KINDS[d.kind]}
  {#if C}<C {...d.props} />{/if}
{/each}
