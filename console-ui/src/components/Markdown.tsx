import { marked, type Token, type Tokens } from 'marked';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { slugify } from '../format';
import { openDoc, stageCli, toast } from '../state';
import { Highlight } from './Code';

/**
 * The reference topics rendered as pages.
 *
 * `marked` reads the markdown. The rendering is done here, token by token,
 * so a table is a table, a code block goes through the same highlighter as
 * a node's source, a link to another topic opens it in the console, and an
 * `fw` command gets a button that puts it on the command line.
 */

const isCommand = (line: string): boolean => /^(fw|flow-weaver)\b/.test(line.trim());

function CodeBlock({ token }: { token: Tokens.Code }) {
  const lang = (token.lang ?? '').split(/\s+/)[0];
  const text = token.text.replace(/\n$/, '');
  const shell = /^(bash|sh|shell|zsh|console)$/.test(lang);
  const copy = () => navigator.clipboard.writeText(text).then(() => toast('copied'));
  if (shell) {
    const lines = text.split('\n');
    return (
      <div class="block cmd">
        <button class="blockbtn copy" onClick={copy} title="Copy">copy</button>
        <pre>
          {lines.map((l, i) => {
            const run = isCommand(l);
            return (
              <div class={`l ${run ? 'run' : ''} ${l.trim().startsWith('#') ? 'c-c' : ''}`} key={i}>
                {run && <button class="play" title="Put on the command line" onClick={() => stageCli(l.trim())}>▶</button>}
                <span>{l || ' '}</span>
              </div>
            );
          })}
        </pre>
      </div>
    );
  }
  return (
    <div class="block">
      <button class="blockbtn copy" onClick={copy} title="Copy">copy</button>
      {/^(ts|typescript|js|javascript|tsx|jsx)$/.test(lang) || lang === '' ? <Highlight source={text} /> : <pre><code>{text}</code></pre>}
    </div>
  );
}

/** A link inside the docs: another topic, an anchor on this page, or the web. */
function Link({ token }: { token: Tokens.Link }) {
  const href = token.href;
  const inner = <Inline tokens={token.tokens} />;
  const topic = href.match(/^([a-z0-9-]+)(?:\.md)?(?:#(.+))?$/i);
  if (topic && !/^https?:/.test(href)) {
    return <a href={`#doc/${topic[1]}${topic[2] ? `/${topic[2]}` : ''}`} onClick={(e) => { e.preventDefault(); openDoc(topic[1], topic[2]); }}>{inner}</a>;
  }
  if (href.startsWith('#')) {
    return <a href={href} onClick={(e) => { e.preventDefault(); document.getElementById(href.slice(1))?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>{inner}</a>;
  }
  return <a href={href} target="_blank" rel="noreferrer">{inner}</a>;
}

function Inline({ tokens }: { tokens?: Token[] }): JSX.Element {
  if (!tokens) return <></>;
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.type) {
          case 'text': return 'tokens' in t && t.tokens ? <Inline key={i} tokens={t.tokens} /> : <span key={i}>{(t as Tokens.Text).text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")}</span>;
          case 'escape': return <span key={i}>{(t as Tokens.Escape).text}</span>;
          case 'strong': return <strong key={i}><Inline tokens={(t as Tokens.Strong).tokens} /></strong>;
          case 'em': return <em key={i}><Inline tokens={(t as Tokens.Em).tokens} /></em>;
          case 'del': return <del key={i}><Inline tokens={(t as Tokens.Del).tokens} /></del>;
          case 'codespan': return <code key={i}>{(t as Tokens.Codespan).text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')}</code>;
          case 'br': return <br key={i} />;
          case 'link': return <Link key={i} token={t as Tokens.Link} />;
          case 'image': return <span key={i} class="hint">[{(t as Tokens.Image).text}]</span>;
          case 'html': return <span key={i}>{(t as Tokens.HTML).text.startsWith('<!--') ? '' : (t as Tokens.HTML).text}</span>;
          default: return <span key={i}>{(t as { raw: string }).raw}</span>;
        }
      })}
    </>
  );
}

function ListItem({ item }: { item: Tokens.ListItem }) {
  return (
    <li>
      {item.task && <input type="checkbox" checked={item.checked} disabled />}
      <Blocks tokens={item.tokens} tight />
    </li>
  );
}

function Blocks({ tokens, tight = false }: { tokens: Token[]; tight?: boolean }): JSX.Element {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.type) {
          case 'heading': {
            const h = t as Tokens.Heading;
            const id = slugify(h.text);
            const Tag = `h${Math.min(6, h.depth)}` as 'h1';
            return <Tag key={i} id={id}><a class="anchor" href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>#</a><Inline tokens={h.tokens} /></Tag>;
          }
          case 'paragraph': return tight ? <span key={i} class="tight"><Inline tokens={(t as Tokens.Paragraph).tokens} /></span> : <p key={i}><Inline tokens={(t as Tokens.Paragraph).tokens} /></p>;
          case 'text': return <span key={i}><Inline tokens={(t as Tokens.Text).tokens ?? [{ type: 'text', raw: (t as Tokens.Text).text, text: (t as Tokens.Text).text } as Token]} /></span>;
          case 'code': return <CodeBlock key={i} token={t as Tokens.Code} />;
          case 'blockquote': return <blockquote key={i}><Blocks tokens={(t as Tokens.Blockquote).tokens} /></blockquote>;
          case 'list': {
            const l = t as Tokens.List;
            const items = l.items.map((it, j) => <ListItem key={j} item={it} />);
            return l.ordered ? <ol key={i} start={Number(l.start) || 1}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
          case 'table': {
            const tb = t as Tokens.Table;
            return (
              <div class="tablewrap" key={i}>
                <table>
                  <thead><tr>{tb.header.map((c, j) => <th key={j} style={c.align ? `text-align:${c.align}` : ''}><Inline tokens={c.tokens} /></th>)}</tr></thead>
                  <tbody>{tb.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} style={c.align ? `text-align:${c.align}` : ''}><Inline tokens={c.tokens} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          }
          case 'hr': return <hr key={i} />;
          case 'html': return (t as Tokens.HTML).text.trim().startsWith('<!--') ? null : <pre key={i} class="rawhtml">{(t as Tokens.HTML).text}</pre>;
          case 'space': return null;
          default: return <p key={i}>{(t as { raw: string }).raw}</p>;
        }
      })}
    </>
  );
}

/**
 * @param title - The page's title as already shown above the article; a
 *   leading `# Title` in the markdown that repeats it is dropped.
 */
export function Markdown({ text, title }: { text: string; title?: string }) {
  const tokens = useMemo(() => {
    const all = marked.lexer(text, { gfm: true });
    const first = all[0];
    if (title && first?.type === 'heading' && (first as Tokens.Heading).depth === 1 && slugify((first as Tokens.Heading).text) === slugify(title)) return all.slice(1);
    return all;
  }, [text, title]);
  return <div class="article"><Blocks tokens={tokens} /></div>;
}
