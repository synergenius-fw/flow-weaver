import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';

/**
 * One tab of a side pane: a glyph, a name, and whatever counts beside it.
 * The glyph says what kind of thing the pane holds; for a step it is the
 * node type's own icon, so the tab reads like the tile in the process.
 */
export function PaneTab({ icon, iconColor, label, on, disabled, onClick, children }: {
  icon: string | null;
  /** The node type's colour, for a step; the tab's text keeps the theme's. */
  iconColor?: string | null;
  label: ComponentChildren;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: ComponentChildren;
}) {
  return (
    <button class={`panetab ${on ? 'on' : ''}`} disabled={disabled} onClick={onClick}>
      {icon && <span class="tabicon" style={iconColor ? `color:${iconColor}` : ''}><Icon name={icon} /></span>}
      <span class="tablabel">{label}</span>
      {children}
    </button>
  );
}
