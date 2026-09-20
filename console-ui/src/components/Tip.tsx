import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { keys } from '../platform';

/**
 * A tooltip of the console's own.
 *
 * The browser's `title` bubble arrives late, looks like nothing else on
 * the page and cannot show a key. This one appears after a short pause
 * beside the thing it names, says the name and, when there is one, the
 * shortcut as the local keyboard writes it, and goes when the pointer
 * does. It is positioned in the viewport, so it is never clipped by the
 * bar's overflow.
 */
export function Tip({ label, shortcut, side = 'right', children }: { label: string; shortcut?: string; side?: 'right' | 'top' | 'bottom'; children: ComponentChildren }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; end: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      // Above or below, the bubble is centred on the control -- unless the
      // control sits by the right edge, where centring would push the text
      // off screen; then it hangs from the control's right side.
      const end = side !== 'right' && r.left + r.width / 2 > window.innerWidth - 180;
      setAt(side === 'right' ? { x: r.right + 8, y: r.top + r.height / 2, end }
        : side === 'top' ? { x: end ? window.innerWidth - r.right : r.left + r.width / 2, y: r.top - 8, end }
          : { x: end ? window.innerWidth - r.right : r.left + r.width / 2, y: r.bottom + 8, end });
    }, 350);
  };
  const hide = () => { window.clearTimeout(timer.current); setAt(null); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span class="tipwrap" ref={ref} onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show} onBlurCapture={hide} onMouseDown={hide}>
      {children}
      {at && (
        <span class={`tip ${side} ${at.end ? 'end' : ''}`} role="tooltip" style={at.end ? `right:${at.x}px; top:${at.y}px` : `left:${at.x}px; top:${at.y}px`}>
          {label}
          {shortcut && <kbd>{keys(shortcut)}</kbd>}
        </span>
      )}
    </span>
  );
}

/** A key combination shown inline, as the local keyboard writes it. */
export function Keys({ combo }: { combo: string }) {
  return <span class="kbd">{keys(combo)}</span>;
}
