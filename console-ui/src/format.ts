export const ago = (t: number): string => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${s | 0}s ago`;
  if (s < 3600) return `${(s / 60) | 0}m ago`;
  if (s < 86400) return `${(s / 3600) | 0}h ago`;
  const d = (s / 86400) | 0;
  return d < 7 ? `${d}d ago` : new Date(t).toLocaleDateString();
};

/** A duration as a person reads one: ms, then seconds, then minutes and hours -- never `84880.0 s`. */
export const ms = (n: number | null | undefined): string => {
  if (n == null) return '';
  if (n < 1) return '<1 ms';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)} s`;
  if (n < 3_600_000) return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
  return `${Math.floor(n / 3_600_000)}h ${Math.round((n % 3_600_000) / 60_000)}m`;
};

export const bytes = (v: unknown): string => {
  const n = JSON.stringify(v)?.length ?? 0;
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
};

export function short(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 57) + '…' : v);
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  const ks = Object.keys(v as object);
  return `{ ${ks.slice(0, 4).join(', ')}${ks.length > 4 ? ', …' : ''} }`;
}

/** Material Symbols ligatures are snake_case; Flow Weaver icon names are camelCase. */
export const iconName = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

const COLORS = new Set(['blue', 'purple', 'cyan', 'orange', 'pink', 'green', 'red', 'yellow', 'teal']);
export const colorVar = (c: string | null | undefined): string | null => (c && COLORS.has(c) ? `var(--c-${c})` : null);

/**
 * A `vscode://file/...` link that works on Windows too.
 *
 * VS Code wants a POSIX-looking path with a leading slash: `C:\\a\\b.ts`
 * has to become `/C:/a/b.ts`, while `/a/b.ts` is already right.
 */
export function editorLink(file: string, line?: number): string {
  const posix = file.replace(/\\/g, '/');
  const rooted = posix.startsWith('/') ? posix : `/${posix}`;
  return `vscode://file${rooted}${line ? `:${line}` : ''}`;
}

/** A heading as an element id, the way GitHub does it: lower case, punctuation dropped, spaces to hyphens. */
export const slugify = (heading: string): string =>
  heading.toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

/** A pack's namespace: `@acme/flow-weaver-pack-audio` → `audio`. */
export const packNs = (name: string): string => name.replace(/^@[^/]+\//, '').replace(/^flow-weaver-pack-/, '');

/** Quote an argument for a command line shown to a person; `splitArgs` gives it back whole. */
export const quoteArgForCli = (arg: string): string => (/[\s"'\\]/.test(arg) || arg === '' ? `"${arg.replace(/(["\\])/g, '\\$1')}"` : arg);
