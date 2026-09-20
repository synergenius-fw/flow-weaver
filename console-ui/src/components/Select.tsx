import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export type Opt = { value: string; label: ComponentChildren; text?: string; disabled?: boolean };

/**
 * A select of the console's own.
 *
 * The native `<select>` box can be styled, but the list it opens cannot:
 * the browser hands that popup to the OS, so on macOS it arrives as a
 * system-blue menu in the system font, unlike anything else on the page.
 * This one draws the box like our other fields (own chevron, already in
 * styles.css) and draws the list itself — a floating panel positioned in
 * the viewport so a scroll container never clips it, with our rows, our
 * tint on the current and the hovered one, keyboard control and
 * type-ahead. `text` is the plain string a rich `label` reduces to, used
 * for the closed box and for type-ahead; it falls back to the value.
 */
export function Select({ value, options, onChange, disabled, class: cls, placeholder, title }: {
  value: string;
  options: Opt[];
  onChange: (value: string) => void;
  disabled?: boolean;
  class?: string;
  placeholder?: string;
  title?: string;
}) {
  const box = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number; width: number; maxWidth: number; above: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const typed = useRef({ s: '', t: 0 });

  const chosen = options.find((o) => o.value === value);
  const text = (o?: Opt) => (o ? (o.text ?? (typeof o.label === 'string' ? o.label : o.value)) : '');

  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    // The panel is at most 280px tall; if it would run off the bottom of
    // the window and there is more room above, it hangs upward instead.
    const below = window.innerHeight - r.bottom;
    const above = below < 200 && r.top > below;
    // The panel is pinned to the box's left and may never reach past the
    // window's right edge, so a long option is truncated, not spilled.
    const gutter = 8;
    const left = Math.max(gutter, Math.min(r.left, window.innerWidth - gutter - r.width));
    const maxWidth = window.innerWidth - gutter - left;
    setAt({ left, top: above ? r.top : r.bottom, width: r.width, maxWidth, above });
  };

  const toggle = () => {
    if (disabled) return;
    if (open) { setOpen(false); return; }
    place();
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (o: Opt) => { if (o.disabled) return; onChange(o.value); setOpen(false); box.current?.focus(); };

  // Close on any click that misses the box and the panel, and on scroll or
  // resize (the panel is positioned absolutely, so it would drift).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Keep the active row in view as the arrows or type-ahead move it.
  useLayoutEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('.opt.active')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const step = (d: number) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + d + options.length) % options.length;
      if (!options[i].disabled) { setActive(i); return; }
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(options.findIndex((o) => !o.disabled)); }
    else if (e.key === 'End') { e.preventDefault(); for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) { setActive(i); break; } }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) pick(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); box.current?.focus(); }
    else if (e.key === 'Tab') { setOpen(false); }
    else if (e.key.length === 1) {
      const now = Date.now();
      typed.current.s = now - typed.current.t < 700 ? typed.current.s + e.key : e.key;
      typed.current.t = now;
      const q = typed.current.s.toLowerCase();
      const hit = options.findIndex((o) => !o.disabled && text(o).toLowerCase().startsWith(q));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <>
      <button
        ref={box}
        type="button"
        class={`selbox ${cls ?? ''} ${open ? 'open' : ''}`}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={onKey}
      >
        <span class={`selval ${chosen ? '' : 'ph'}`}>{chosen ? chosen.label : (placeholder ?? '')}</span>
      </button>
      {open && at && (
        <div
          ref={panel}
          class={`selpanel ${at.above ? 'above' : ''}`}
          role="listbox"
          style={`left:${at.left}px; ${at.above ? `bottom:${window.innerHeight - at.top}px` : `top:${at.top}px`}; min-width:${at.width}px; max-width:${at.maxWidth}px`}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              class={`opt ${o.value === value ? 'on' : ''} ${i === active ? 'active' : ''} ${o.disabled ? 'off' : ''}`}
              onMouseEnter={() => !o.disabled && setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >
              <span class="lbl">{o.label}</span>
              {o.value === value && <span class="ms tick">check</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
