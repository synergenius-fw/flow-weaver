import { iconsReady } from '../state';
import { iconName } from '../format';

/** A Material Symbol by Flow Weaver icon name; renders nothing until the font is available. */
export function Icon({ name }: { name: string }) {
  if (!iconsReady.value) return null;
  return <span class="ms" aria-hidden="true">{iconName(name)}</span>;
}

const KIND_ICON: Record<string, string> = {
  approval: 'how_to_reg',
  input: 'keyboard',
  agent: 'smart_toy',
  loop: 'repeat',
  effect: 'bolt',
  pull: 'download',
};

export function kindIcon(kind: string | null | undefined): string | null {
  return kind ? KIND_ICON[kind] ?? null : null;
}
