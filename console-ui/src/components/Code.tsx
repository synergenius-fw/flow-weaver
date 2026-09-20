import { useMemo, useState, useEffect } from 'preact/hooks';
import { editorLink } from '../format';
import { Keys } from './Tip';
import { tokenizeLines, type Tok } from '../tokens';

function Lines({ lines, startLine, highlight }: { lines: Tok[][]; startLine: number; highlight: number[] }) {
  return (
    <pre>
      {lines.map((toks, i) => (
        <div class={`l ${highlight.includes(startLine + i) ? 'hl' : ''}`} key={i}>
          <span class="n">{startLine + i}</span>
          <span>{toks.length ? toks.map((t, j) => (t.t ? <span class={`c-${t.t}`} key={j}>{t.c}</span> : t.c)) : ' '}</span>
        </div>
      ))}
    </pre>
  );
}

/** Highlighted code without line numbers, wrapped: for a code block in a page. */
export function Highlight({ source }: { source: string }) {
  const lines = useMemo(() => tokenizeLines(source), [source]);
  return (
    <pre class="hlcode">
      {lines.map((toks, i) => (
        <div class="l" key={i}>{toks.length ? toks.map((t, j) => (t.t ? <span class={`c-${t.t}`} key={j}>{t.c}</span> : t.c)) : ' '}</div>
      ))}
    </pre>
  );
}

export interface CodeProps {
  source: string;
  startLine?: number;
  highlight?: number[];
  /** What this is, shown in the full-screen header. */
  title?: string;
  /** Where it lives, as `path:line`, linked to the editor. */
  file?: { path: string; label: string; line: number };
}

/**
 * Code in the inspector column wraps: a horizontal scrollbar in a 350px pane
 * hides the end of every long line behind a gesture. Full screen gives the
 * code the window instead, where lines have room to keep their shape -- so
 * wrapping becomes a choice there rather than a necessity.
 */
export function Code({ source, startLine = 1, highlight = [], title, file }: CodeProps) {
  const lines = useMemo(() => tokenizeLines(source), [source]);
  const [full, setFull] = useState(false);
  // Wrapped by default even full screen: a window is not always wide, and a
  // line running off the right edge is the thing being fixed.
  const [wrap, setWrap] = useState(true);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  if (full) {
    return (
      <div class={`codefull ${wrap ? '' : 'nowrap'}`}>
        <div class="fullhead">
          <b>{title ?? 'Code'}</b>
          {file && <a class="mono" href={editorLink(file.path, file.line)}>{file.label}</a>}
          <span class="sp" />
          <button class="code-toggle" onClick={() => setWrap(!wrap)}>{wrap ? 'no wrap' : 'wrap'}</button>
          <button class="btn sm" onClick={() => setFull(false)}>Close<Keys combo="esc" /></button>
        </div>
        <div class="code">
          <Lines lines={lines} startLine={startLine} highlight={highlight} />
        </div>
      </div>
    );
  }

  return (
    <div class="codewrap">
      <button class="expand" title="Full screen" onClick={() => setFull(true)}>⤢</button>
      <div class="code">
        <Lines lines={lines} startLine={startLine} highlight={highlight} />
      </div>
    </div>
  );
}
