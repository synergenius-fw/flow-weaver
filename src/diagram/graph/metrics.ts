/**
 * How big things are on the diagram graph.
 *
 * Decides the sizes every other graph module works from: the port dot and
 * column spacing, the smallest node box, the room a node label takes above
 * its box, and how wide a port label badge is, measured in the renderer's
 * font. The numbers match the editor's React node so the ASCII and SVG
 * views line up with it.
 */
import { TYPE_ABBREVIATIONS } from '../theme';
import type { DiagramPort } from '../types';

// ---- Constants (matching React component-node) ----

export const PORT_RADIUS = 7;
export const PORT_SIZE = PORT_RADIUS * 2; // 14px — matches portRootStyle
export const PORT_GAP = 8;               // matches port column gap
export const PORT_PADDING_Y = 18;        // matches inputsStyle paddingTop/Bottom
export const NODE_MIN_WIDTH = 90;         // matches NODE_MIN_WIDTH in styles.ts
export const NODE_MIN_HEIGHT = 90;        // matches NODE_MIN_HEIGHT in styles.ts
export const LABEL_CLEARANCE = 42;           // breathing room between opposing port label badges
export const LABEL_HEIGHT = 24;           // 18px font + breathing room
export const LABEL_GAP = 12;             // matches labelRootStyle bottom: calc(100% + 12px)

// ---- Font metrics (Montserrat 600-weight, 10px, measured via SVG getBBox) ----

const CHAR_WIDTHS: Record<string, number> = {
  ' ': 2.78, '!': 3.34, '"': 4.74, '#': 5.56, '$': 5.56, '%': 8.9, '&': 7.23,
  "'": 2.38, '(': 3.34, ')': 3.34, '*': 3.9, '+': 5.84, ',': 2.78, '-': 3.34,
  '.': 2.78, '/': 3.95, '0': 5.56, '1': 5.56, '2': 5.56, '3': 5.56, '4': 5.56,
  '5': 5.56, '6': 5.56, '7': 5.56, '8': 5.56, '9': 5.56, ':': 3.34, ';': 3.34,
  '<': 5.86, '=': 5.84, '>': 5.86, '?': 6.11, '@': 9.76,
  A: 7.23, B: 7.23, C: 7.23, D: 7.23, E: 6.67, F: 6.11, G: 7.78, H: 7.23,
  I: 2.78, J: 5.56, K: 7.23, L: 6.11, M: 8.34, N: 7.23, O: 7.78, P: 6.67,
  Q: 7.78, R: 7.23, S: 6.67, T: 6.11, U: 7.23, V: 6.67, W: 9.45, X: 6.67,
  Y: 6.67, Z: 6.11, '[': 3.34, '\\': 3.95, ']': 3.34, '^': 5.84, '_': 5.56, '`': 3.58,
  a: 5.56, b: 6.11, c: 5.56, d: 6.11, e: 5.56, f: 3.34, g: 6.11, h: 6.11,
  i: 2.78, j: 2.78, k: 5.56, l: 2.78, m: 8.9, n: 6.11, o: 6.11, p: 6.11,
  q: 6.11, r: 3.9, s: 5.56, t: 3.34, u: 6.11, v: 5.56, w: 7.78, x: 5.56,
  y: 5.56, z: 5, '{': 3.9, '|': 2.8, '}': 3.9, '~': 5.96,
};
const DEFAULT_CHAR_WIDTH = 5.56;

/** Measure text width using pre-computed Montserrat 600/10px SVG character widths */
export function measureText(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += CHAR_WIDTHS[text[i]] ?? DEFAULT_CHAR_WIDTH;
  }
  return width;
}

/** Compute the full badge width for a port label (matches renderer badge layout) */
export function portBadgeWidth(port: DiagramPort): number {
  const abbrev = TYPE_ABBREVIATIONS[port.dataType] ?? port.dataType;
  const typeWidth = measureText(abbrev);
  const labelWidth = measureText(port.label);
  const pad = 7;
  const divGap = 4;
  return pad + typeWidth + divGap + 1 + divGap + labelWidth + pad;
}

/** Total extent of a port label from the port dot center outward (badge + gap + dot radius) */
export function portLabelExtent(port: DiagramPort): number {
  const badgeGap = 5;
  return PORT_RADIUS + badgeGap + portBadgeWidth(port);
}

/** Estimate the maximum port label badge extent beyond the node edge */
export function maxPortLabelExtent(ports: readonly DiagramPort[]): number {
  if (ports.length === 0) return 0;
  let max = 0;
  for (const port of ports) {
    const abbrev = TYPE_ABBREVIATIONS[port.dataType] ?? port.dataType;
    const badgeTextWidth = measureText(abbrev) + measureText(port.label);
    const badgeWidth = badgeTextWidth + 23; // 7px pad + 4px + 1px divider + 4px + 7px pad
    // PORT_RADIUS + gap(5) + badgeWidth
    max = Math.max(max, PORT_RADIUS + 5 + badgeWidth);
  }
  return max;
}

/** Height of a column of `count` ports, padding included (0 for no ports). */
export function portsColumnHeight(count: number): number {
  if (count === 0) return 0;
  return PORT_PADDING_Y + count * PORT_SIZE + (count - 1) * PORT_GAP + PORT_PADDING_Y;
}
