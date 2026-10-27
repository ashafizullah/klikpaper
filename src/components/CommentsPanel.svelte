<script lang="ts">
  // The Comments panel: every thread in the document, in page order, with
  // replies, "done" marks and the box for a comment just placed on a page.
  // Comments are saved inside the PDF with the file, so whoever opens it next
  // (in KlikPaper or another PDF reader) can read and answer them.
  import { tick } from "svelte";
  import type { Comment, Doc } from "../lib/doc.svelte";
  import { commentAuthor, setCommentAuthor, sortedThreads, suggestedAuthor } from "../lib/comments.svelte";
  import { persist, settings } from "../lib/settings.svelte";
  import { mod, ui } from "../lib/ui.svelte";
  import { viewer } from "../lib/viewer.svelte";
  import { i18n, t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  let list: HTMLDivElement;

  let showDone = $state(false);
  let draftText = $state("");
  let replies = $state<Record<string, string>>({});
  let editing = $state<{ thread: string; reply: string | null; text: string } | null>(null);
  let name = $state("");
  let naming = $state(false);
  suggestedAuthor().then((n) => (name = n));

  const threads = $derived(sortedThreads(doc));
  const doneCount = $derived(threads.filter((c) => c.resolved).length);
  const shown = $derived(showDone ? threads : threads.filter((c) => !c.resolved || c.id === doc.selectedComment));
  const numbers = $derived(new Map(threads.map((c, i) => [c.id, i + 1])));
  const pageNumber = (c: Comment) => doc.pages.findIndex((p) => p.id === c.page) + 1;
  const draftPage = $derived(ui.commentDraft ? doc.pages.findIndex((p) => p.id === ui.commentDraft!.page) + 1 : 0);

  function close() {
    settings.showComments = false;
    persist();
    ui.commentDraft = null;
  }

  function ago(iso: string): string {
    const time = Date.parse(iso);
    if (!iso || Number.isNaN(time)) return "";
    const secs = (Date.now() - time) / 1000;
    if (secs < 60) return t("comments.justNow");
    const rtf = new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" });
    if (secs < 3600) return rtf.format(-Math.round(secs / 60), "minute");
    if (secs < 86400) return rtf.format(-Math.round(secs / 3600), "hour");
    if (secs < 7 * 86400) return rtf.format(-Math.round(secs / 86400), "day");
    return new Date(time).toLocaleDateString(i18n.locale, { day: "numeric", month: "short", year: "numeric" });
  }

  function fullDate(iso: string): string {
    const time = Date.parse(iso);
    return Number.isNaN(time) ? "" : new Date(time).toLocaleString(i18n.locale);
  }

  /** A steady color per name, for the initial's circle. */
  function hue(author: string): number {
    let h = 0;
    for (const ch of author) h = (h * 31 + ch.codePointAt(0)!) % 360;
    return h;
  }
  const initial = (author: string) => (author.trim()[0] ?? "?").toUpperCase();

  async function post() {
    const d = ui.commentDraft;
    const text = draftText.trim();
    if (!d || !text) return;
    doc.addComment(d.page, d.x, d.y, text, await commentAuthor());
    ui.commentDraft = null;
    draftText = "";
  }

  async function sendReply(c: Comment) {
    const text = (replies[c.id] ?? "").trim();
    if (!text) return;
    doc.reply(c.id, text, await commentAuthor());
    replies[c.id] = "";
  }

  function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    if (text) doc.editComment(editing.thread, editing.reply, text);
    editing = null;
  }

  function select(c: Comment) {
    doc.selectedComment = c.id;
    const i = doc.pages.findIndex((p) => p.id === c.page);
    if (i >= 0 && i !== doc.current) viewer.goTo(i);
  }

  /** Enter (or Cmd/Ctrl+Enter) sends; Shift+Enter starts a new line; Escape cancels. */
  function keys(e: KeyboardEvent, send: () => void, cancel?: () => void) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && cancel) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  function saveName() {
    setCommentAuthor(name);
    naming = false;
    suggestedAuthor().then((n) => (name = n));
  }

  // A comment picked on the page scrolls into view.
  $effect(() => {
    const id = doc.selectedComment;
    if (!id) return;
    tick().then(() => list?.querySelector(`[data-comment="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  });

  function focusOnMount(el: HTMLTextAreaElement) {
    tick().then(() => el.focus());
  }
</script>

<aside class="panel" aria-label={t("comments.title")}>
  <div class="head">
    <span class="title"><Icon name="comments" size={14} />{t("comments.title")}</span>
    {#if threads.length}<span class="count">{threads.length - doneCount}</span>{/if}
    <span class="grow"></span>
    <button class="icon-btn" class:on={ui.tool === "comment"} onclick={() => (ui.tool = ui.tool === "comment" ? "select" : "comment")} title={t("comments.tool")} aria-label={t("comments.add")}>
      <Icon name="comment" />
    </button>
    <button class="icon-btn" onclick={close} title={t("common.close")} aria-label={t("common.close")}><Icon name="close" /></button>
  </div>

  <div class="who">
    {#if naming}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="field" bind:value={name} placeholder={t("comments.namePlaceholder")} autofocus onkeydown={(e) => keys(e, saveName, () => (naming = false))} onblur={saveName} />
    {:else}
      <span class="muted">{t("comments.as")}</span>
      <span class="avatar small" style:--h={hue(name)}>{initial(name)}</span>
      <strong>{name || "…"}</strong>
      <button class="link" onclick={() => (naming = true)}>{t("comments.change")}</button>
    {/if}
  </div>

  <div class="list selectable" bind:this={list}>
    {#if ui.commentDraft}
      <div class="card draft">
        <div class="meta"><Icon name="comment" size={13} /><span>{t("comments.new", { n: draftPage })}</span></div>
        <textarea class="field" rows="3" placeholder={t("comments.placeholder")} bind:value={draftText} use:focusOnMount onkeydown={(e) => keys(e, post, () => (ui.commentDraft = null))}></textarea>
        <div class="actions">
          <span class="hint">{t("comments.sendHint")}</span>
          <button class="btn" onclick={() => ((ui.commentDraft = null), (draftText = ""))}>{t("common.cancel")}</button>
          <button class="btn primary" disabled={!draftText.trim()} onclick={post}>{t("comments.post")}</button>
        </div>
      </div>
    {/if}

    {#if !threads.length && !ui.commentDraft}
      <div class="empty">
        <span class="big"><Icon name="comments" size={24} /></span>
        <strong>{t("comments.emptyTitle")}</strong>
        <p class="muted">{t("comments.emptyBody")}</p>
        <button class="btn primary" onclick={() => (ui.tool = "comment")}><Icon name="comment" size={14} />{t("comments.add")}</button>
      </div>
    {/if}

    {#each shown as c (c.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="card" class:on={doc.selectedComment === c.id} class:done={c.resolved} data-comment={c.id} onclick={() => select(c)}>
        <div class="meta">
          <span class="num">{numbers.get(c.id)}</span>
          <span class="muted">{t("comments.page", { n: pageNumber(c) })}</span>
          <span class="grow"></span>
          {#if c.resolved}<span class="tag"><Icon name="resolved" size={11} />{t("comments.done")}</span>{/if}
          <button class="icon-btn tiny" onclick={(e) => (e.stopPropagation(), doc.setResolved(c.id, !c.resolved))} title={c.resolved ? t("comments.reopen") : t("comments.resolve")} aria-label={c.resolved ? t("comments.reopen") : t("comments.resolve")}>
            <Icon name={c.resolved ? "refresh" : "check"} size={13} />
          </button>
          <button class="icon-btn tiny" onclick={(e) => (e.stopPropagation(), doc.deleteComment(c.id))} title={t("comments.delete")} aria-label={t("comments.delete")}>
            <Icon name="trash" size={13} />
          </button>
        </div>

        {#each [{ id: null, author: c.author, date: c.date, text: c.text }, ...c.replies] as entry, i (entry.id ?? "root")}
          <div class="entry" class:reply={i > 0}>
            <span class="avatar" style:--h={hue(entry.author)}>{initial(entry.author)}</span>
            <div class="body">
              <div class="line">
                <strong>{entry.author || "—"}</strong>
                <span class="muted when" title={fullDate(entry.date)}>{ago(entry.date)}</span>
                {#if entry.author === name}
                  <button class="link" onclick={(e) => (e.stopPropagation(), (editing = { thread: c.id, reply: entry.id, text: entry.text }))}>{t("comments.edit")}</button>
                {/if}
                {#if i > 0}
                  <button class="link" onclick={(e) => (e.stopPropagation(), doc.deleteComment(c.id, entry.id))}>{t("comments.delete")}</button>
                {/if}
              </div>
              {#if editing && editing.thread === c.id && editing.reply === entry.id}
                <textarea class="field" rows="2" bind:value={editing.text} use:focusOnMount onclick={(e) => e.stopPropagation()} onkeydown={(e) => keys(e, saveEdit, () => (editing = null))} onblur={saveEdit}></textarea>
              {:else}
                <p class="text">{entry.text}</p>
              {/if}
            </div>
          </div>
        {/each}

        {#if !c.resolved}
          <div class="reply-box">
            <textarea
              class="field"
              rows="1"
              placeholder={t("comments.replyPlaceholder")}
              bind:value={replies[c.id]}
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => keys(e, () => sendReply(c))}
            ></textarea>
            <button class="icon-btn send" disabled={!(replies[c.id] ?? "").trim()} onclick={(e) => (e.stopPropagation(), sendReply(c))} title={t("comments.reply")} aria-label={t("comments.reply")}>
              <Icon name="send" size={14} />
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if doneCount}
      <button class="link toggle" onclick={() => (showDone = !showDone)}>{showDone ? t("comments.hideDone") : t("comments.showDone", { n: doneCount })}</button>
    {/if}
  </div>

  <p class="foot" class:warn={doc.dirty && threads.length}>
    {#if doc.dirty && threads.length}
      <Icon name="save" size={12} />{t("comments.unsaved", { key: `${mod}S` })}
    {:else}
      {t("comments.shared")}
    {/if}
  </p>
</aside>

<style>
  .panel {
    width: 320px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--line);
    background: var(--panel);
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 8px 9px 12px;
    border-bottom: 1px solid var(--line);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 500 15px var(--serif);
    letter-spacing: -0.01em;
  }
  .title :global(svg) {
    color: var(--accent);
  }
  .count {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--selection);
    color: var(--accent);
    font: 600 10.5px/18px var(--mono);
    text-align: center;
  }
  .grow {
    flex: 1;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    font-size: 11.5px;
    min-height: 40px;
  }
  .who strong {
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who .field {
    flex: 1;
    height: 26px;
    font-size: 12px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel-2);
    padding: 9px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: default;
    transition: border-color 0.15s;
  }
  .card.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .card.done {
    opacity: 0.7;
  }
  .card.draft {
    border-color: var(--accent);
    border-style: dashed;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .card.draft .meta {
    color: var(--accent);
    font-weight: 500;
  }
  .num {
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 9px 9px 9px 2px;
    background: #f5b82e;
    color: #2b2412;
    font: 600 10px/18px var(--mono);
    text-align: center;
  }
  .card.done .num {
    background: #9ca3af;
    color: #fff;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--muted);
    font-size: 10.5px;
  }
  .icon-btn.tiny {
    width: 22px;
    height: 22px;
  }
  .entry {
    display: flex;
    gap: 8px;
  }
  .entry.reply {
    padding-left: 12px;
    border-left: 2px solid var(--line);
    margin-left: 10px;
  }
  .avatar {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: hsl(var(--h) 55% 45%);
    color: #fff;
    font: 600 10.5px var(--sans, inherit);
  }
  .avatar.small {
    width: 18px;
    height: 18px;
    font-size: 9.5px;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 11.5px;
  }
  .line strong {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    font-size: 10.5px;
    flex: 1;
  }
  .text {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  textarea.field {
    width: 100%;
    resize: vertical;
    font-size: 12.5px;
    line-height: 1.4;
    padding: 6px 8px;
    min-height: 0;
  }
  .reply-box {
    display: flex;
    gap: 4px;
    align-items: flex-end;
  }
  .reply-box textarea {
    resize: none;
    field-sizing: content;
    max-height: 120px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hint {
    flex: 1;
    font-size: 10.5px;
    color: var(--muted);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
    padding: 24px 8px;
    font-size: 12px;
    line-height: 1.55;
  }
  .empty p {
    margin: 0;
  }
  .big {
    color: var(--accent);
    line-height: 0;
  }
  .toggle {
    align-self: center;
    padding: 4px;
  }
  .foot {
    margin: 0;
    padding: 9px 12px;
    border-top: 1px solid var(--line);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--muted);
  }
  .foot.warn {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .foot.warn :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
</style>
