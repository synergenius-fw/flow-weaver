import { useRef } from 'preact/hooks';
import { tokenizeJson } from '../tokens';

/**
 * An editable JSON field that is syntax-coloured as you type.
 *
 * A `<textarea>` cannot colour its own text, so the text is drawn twice: a
 * highlighted `<pre>` mirror underneath, and the real textarea on top with a
 * transparent colour and a visible caret. The two share the exact same font,
 * padding and wrapping, so the caret and the coloured glyphs line up; the
 * mirror is scrolled to follow the textarea. The mirror uses the same `j-*`
 * classes as the read-only value view, so a key, a string, a number, a
 * boolean and null read the same here as everywhere else.
 */
export function JsonEditor({ value, onInput, rows = 4, placeholder, invalid }: {
  value: string;
  onInput: (text: string) => void;
  rows?: number;
  placeholder?: string;
  invalid?: boolean;
}) {
  const mirror = useRef<HTMLPreElement>(null);
  const toks = tokenizeJson(value);
  // A trailing newline needs a spacer so the mirror's last line has height.
  const trailingNl = value.endsWith('\n');
  return (
    <div class={`jsoned ${invalid ? 'bad' : ''}`}>
      <pre class="jsoned-mirror json" ref={mirror} aria-hidden="true">
        {value === '' && placeholder ? <span class="jsoned-ph">{placeholder}</span> : toks.map((t, i) => (
          t.t ? <span class={`j-${t.t}`} key={i}>{t.c}</span> : <span key={i}>{t.c}</span>
        ))}
        {trailingNl ? '​' : ''}
      </pre>
      <textarea
        class="jsoned-input"
        rows={rows}
        value={value}
        spellcheck={false}
        onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
        onScroll={(e) => { const el = mirror.current; if (el) { el.scrollTop = (e.target as HTMLTextAreaElement).scrollTop; el.scrollLeft = (e.target as HTMLTextAreaElement).scrollLeft; } }}
      />
    </div>
  );
}
