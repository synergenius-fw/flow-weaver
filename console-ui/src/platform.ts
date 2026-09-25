/**
 * What the keyboard in front of the person looks like.
 *
 * The console runs wherever a browser does. A shortcut is the same key
 * everywhere -- ⌘K on a Mac is Ctrl+K elsewhere -- and its label should
 * say what is printed on that keyboard, not what is printed on the
 * developer's.
 */
const ua = typeof navigator === 'undefined' ? '' : `${(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;

const isMac = /Mac|iPhone|iPad|iPod/i.test(ua);

/** A key combination as the local keyboard writes it: `mod+K` → `⌘K` or `Ctrl+K`, `shift+F5` → `⇧F5` or `Shift+F5`. */
export function keys(combo: string): string {
  return combo.split('+').map((part) => {
    const p = part.trim().toLowerCase();
    if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
    if (p === 'shift') return isMac ? '⇧' : 'Shift';
    if (p === 'alt') return isMac ? '⌥' : 'Alt';
    if (p === 'ctrl') return isMac ? '⌃' : 'Ctrl';
    if (p === 'esc') return 'Esc';
    if (p === 'enter') return isMac ? '↩' : 'Enter';
    return part.trim().length === 1 ? part.trim().toUpperCase() : part.trim();
  }).join(isMac ? '' : '+');
}
