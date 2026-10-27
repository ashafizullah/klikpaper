import { expect, test } from "bun:test";
import { changelogSection } from "./changelog";

const md = "# Changelog\n\n## Unreleased\n\n- Next\n\n## 0.1.5\n\n- Terminal\n- Fonts\n\n## 0.1.4\n\n- MCP setup\n";

test("takes one version's section", () => {
  expect(changelogSection(md, "0.1.5")).toBe("- Terminal\n- Fonts");
  expect(changelogSection(md, "0.1.4")).toBe("- MCP setup");
});

test("is empty for a version without a section", () => {
  expect(changelogSection(md, "0.2.0")).toBe("");
  // "0.1.5" must not match "0.1.50".
  expect(changelogSection("## 0.1.50\n\n- x", "0.1.5")).toBe("");
});
