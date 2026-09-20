import { useState } from 'preact/hooks';
import { bytes } from '../format';
import { Json, JsonInline } from './Json';

/** A value at a glance, expandable to pretty JSON. Large values show their size. */
export function Value({ value, open: initial = false, static: isStatic = false }: { value: unknown; open?: boolean; static?: boolean }) {
  const [open, setOpen] = useState(initial);
  if (value === undefined) return <span class="val static" style="color:var(--faint)">—</span>;
  const big = typeof value === 'object' && value !== null;
  return (
    <span class={`val ${isStatic || !big ? 'static' : ''}`} onClick={() => big && !isStatic && setOpen(!open)}>
      {open && big ? <Json value={value} /> : <JsonInline value={value} />}
      {big && <span class="sz">{bytes(value)}</span>}
    </span>
  );
}
