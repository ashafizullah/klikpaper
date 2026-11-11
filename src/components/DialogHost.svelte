<script lang="ts">
  // Tells a dialog which entry of the stack it is, so it can close itself (ownDialog).
  import { setContext, type Component } from "svelte";
  import { DIALOG } from "../lib/ui.svelte";

  let { id, component: C, props }: { id: number; component: Component<any>; props: Record<string, unknown> } = $props();
  // The id of an entry never changes.
  // svelte-ignore state_referenced_locally
  setContext(DIALOG, id);
</script>

<C {...props} />
