import { expect, test } from "bun:test";
import { renderMarkdown } from "./markdown";

test("escapes HTML from the model", () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)"> **bold**');
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  expect(html).toContain("<strong>bold</strong>");
});

test("renders lists, code and page citations", () => {
  const html = renderMarkdown("Ringkasan [p. 3] dan [hal. 4-5]:\n\n- satu\n- dua\n\n```\na < b\n```");
  expect(html).toContain('<button class="cite" data-page="3">p. 3</button>');
  expect(html).toContain('data-page="4">p. 4–5</button>');
  expect(html).toContain("<ul><li>satu</li><li>dua</li></ul>");
  expect(html).toContain("<pre><code>a &lt; b</code></pre>");
});
