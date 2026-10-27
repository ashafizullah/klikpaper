// One version's section of a changelog (CHANGELOG.md in English, CHANGELOG.id.md
// in Indonesian): the lines under its "## x.y.z" heading, up to the next one.

export function changelogSection(markdown: string, version: string): string {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}
