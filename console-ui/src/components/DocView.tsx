import { useEffect, useRef } from 'preact/hooks';
import { doc, docAnchor, docHeading, toast, view } from '../state';
import { slugify } from '../format';
import { Markdown } from './Markdown';

/**
 * A topic in the centre of the console.
 *
 * The rail names it, the right pane lists its sections and what in the
 * project it touches; this is the page itself. Scrolling keeps the
 * contents list in step, and opening an anchor lands on it.
 */
export function DocView() {
  const d = doc.value;
  const ref = useRef<HTMLDivElement>(null);
  const v = view.value;

  // Land on the anchor once the page is there, or at the top when there is none.
  useEffect(() => {
    if (!d) return;
    const col = ref.current?.closest('.col');
    const anchor = docAnchor.value;
    if (anchor) {
      // An error code is opened by its code, and its heading may be
      // "3. UNKNOWN_SOURCE_PORT / UNKNOWN_TARGET_PORT": fall back to the
      // first heading that mentions it.
      const heads = [...(ref.current?.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]') ?? [])];
      const el = document.getElementById(slugify(anchor)) ?? document.getElementById(anchor)
        ?? heads.find((h) => (h.textContent ?? '').toLowerCase().includes(anchor.toLowerCase()));
      if (el) { el.scrollIntoView({ block: 'start' }); return; }
    }
    col?.scrollTo({ top: 0 });
  }, [d?.slug, docAnchor.value]);

  // Which heading is in view, for the contents pane.
  useEffect(() => {
    const col = ref.current?.closest('.col');
    if (!col || !d) return;
    const onScroll = () => {
      const heads = ref.current?.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]') ?? [];
      const top = col.getBoundingClientRect().top + 12;
      let current = '';
      for (const h of heads) { if (h.getBoundingClientRect().top - top <= 0) current = h.id; else break; }
      if (current !== docHeading.value) docHeading.value = current;
    };
    onScroll();
    col.addEventListener('scroll', onScroll, { passive: true });
    return () => col.removeEventListener('scroll', onScroll);
  }, [d?.slug]);

  if (v.kind !== 'doc') return null;
  if (!d) return <div class="hint" style="padding:40px 0">Loading…</div>;

  const copy = () => navigator.clipboard.writeText(d.compact).then(() => toast('copied compact topic'));
  return (
    <div class="docview" ref={ref}>
      <div class="dochead">
        <h1>{d.name}</h1>
        {d.description && <p class="lede">{d.description}</p>}
        <div class="docactions">
          <button class="btn sm" onClick={copy} title="The compact form of this topic, as fw_docs gives it to an assistant">Copy for your assistant</button>
        </div>
      </div>
      <Markdown text={d.markdown} title={d.name} />
    </div>
  );
}
