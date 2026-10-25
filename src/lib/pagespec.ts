// Page lists as people type them: "1-3, 5, 8-".

/** 1-based page numbers in order, or an error message key. */
export function parsePages(input: string, total: number): number[] | null {
  const out: number[] = [];
  const parts = input.split(/[,;\s]+/).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part);
    if (m) {
      const from = m[1] ? Number(m[1]) : 1;
      const to = m[2] ? Number(m[2]) : total;
      if (from < 1 || to > total || from > to) return null;
      for (let p = from; p <= to; p++) out.push(p);
    } else if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p < 1 || p > total) return null;
      out.push(p);
    } else {
      return null;
    }
  }
  return out;
}

/** Compact form of a page list: [1,2,3,5] -> "1-3, 5". */
export function formatPages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return runs.join(", ");
}

/** Groups of 1-based pages for splitting a document. */
export function splitGroups(total: number, mode: { every: number } | { ranges: string }): number[][] | null {
  if ("every" in mode) {
    const n = Math.floor(mode.every);
    if (!(n >= 1)) return null;
    const groups: number[][] = [];
    for (let p = 1; p <= total; p += n) groups.push(Array.from({ length: Math.min(n, total - p + 1) }, (_, i) => p + i));
    return groups;
  }
  const groups: number[][] = [];
  for (const chunk of mode.ranges.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const pages = parsePages(chunk, total);
    if (!pages) return null;
    groups.push(pages);
  }
  return groups.length ? groups : null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}
