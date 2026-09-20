import type { JSX } from 'preact';
import { classifyExpr } from '../expr';

const CLASS = { string: 'j-str', number: 'j-num', boolean: 'j-bool', nullish: 'j-null', js: 'e-js' } as const;

/** An `[expr:]` binding, coloured for what it is. */
export function Expr({ value }: { value: string }): JSX.Element {
  const e = classifyExpr(value);
  if (e.kind === 'reference') return <PortRef node={e.node} port={e.port} />;
  return <span class={CLASS[e.kind]}>{e.text}</span>;
}

/** `node.port`: the step it comes from is the part worth picking out. */
export function PortRef({ node, port }: { node: string; port: string }): JSX.Element {
  return (
    <>
      <span class="e-node">{node}</span>
      <span class="e-dot">.{port}</span>
    </>
  );
}
