/**
 * Values on screen are data the run produced, so they are rendered as JSON
 * with the same colours the code pane uses: a key is not a string, a number
 * is not a boolean, and `null` reads as absent rather than as text.
 *
 * Serialising and re-parsing with a regex would lose that distinction, so
 * the value is walked directly.
 */
import type { JSX } from 'preact';

const INDENT = '  ';

function scalar(v: unknown, key: string): JSX.Element {
  if (v === null) return <span class="j-null" key={key}>null</span>;
  if (typeof v === 'string') return <span class="j-str" key={key}>{JSON.stringify(v)}</span>;
  if (typeof v === 'number') return <span class="j-num" key={key}>{String(v)}</span>;
  if (typeof v === 'boolean') return <span class="j-bool" key={key}>{String(v)}</span>;
  return <span key={key}>{String(v)}</span>;
}

function render(v: unknown, depth: number, key: string): JSX.Element {
  const pad = INDENT.repeat(depth);
  const padIn = INDENT.repeat(depth + 1);

  if (Array.isArray(v)) {
    if (v.length === 0) return <span key={key}>[]</span>;
    return (
      <span key={key}>
        {'[\n'}
        {v.map((item, i) => (
          <span key={i}>
            {padIn}
            {render(item, depth + 1, String(i))}
            {i < v.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {pad}]
      </span>
    );
  }

  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return <span key={key}>{'{}'}</span>;
    return (
      <span key={key}>
        {'{\n'}
        {entries.map(([k, val], i) => (
          <span key={k}>
            {padIn}
            <span class="j-key">{JSON.stringify(k)}</span>
            {': '}
            {render(val, depth + 1, k)}
            {i < entries.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {pad}
        {'}'}
      </span>
    );
  }

  return scalar(v, key);
}

/** Pretty-printed, syntax-coloured JSON. */
export function Json({ value }: { value: unknown }) {
  return <span class="json">{render(value, 0, 'root')}</span>;
}

/** The same colours on one line, for a value shown inline. */
export function JsonInline({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') return <span class="json">{scalar(value, 'v')}</span>;
  if (Array.isArray(value)) return <span class="json">[{value.length}]</span>;
  const keys = Object.keys(value as object);
  return (
    <span class="json">
      {'{ '}
      {keys.slice(0, 4).map((k, i) => (
        <span key={k}><span class="j-key">{k}</span>{i < Math.min(keys.length, 4) - 1 ? ', ' : ''}</span>
      ))}
      {keys.length > 4 ? ', …' : ''}
      {' }'}
    </span>
  );
}
