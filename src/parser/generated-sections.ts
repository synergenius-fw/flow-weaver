/**
 * In-place generation markers.
 *
 * `fw compile` writes generated code into the authored file between these
 * marker comments. The parser has to recognize and strip those sections before
 * it reads annotations, and the in-place generator writes them, so the markers
 * and the helpers that detect and remove them live here, below both.
 */

// Marker constants
export const MARKERS = {
  RUNTIME_START: '// @flow-weaver-runtime-start',
  RUNTIME_END: '// @flow-weaver-runtime-end',
  BODY_START: '// @flow-weaver-body-start',
  BODY_END: '// @flow-weaver-body-end',
  IMPORTS_START: '// @flow-weaver-imports-start',
  IMPORTS_END: '// @flow-weaver-imports-end',
};

/**
 * Check if source code has in-place generation markers
 */
export function hasInPlaceMarkers(source: string): boolean {
  return (
    source.includes(MARKERS.RUNTIME_START) &&
    source.includes(MARKERS.RUNTIME_END) &&
    source.includes(MARKERS.BODY_START) &&
    source.includes(MARKERS.BODY_END)
  );
}

/**
 * Remove all generated sections from source code
 */
export function stripGeneratedSections(source: string): string {
  let result = source;

  // Remove runtime section
  const runtimeStartIdx = result.indexOf(MARKERS.RUNTIME_START);
  const runtimeEndIdx = result.indexOf(MARKERS.RUNTIME_END);
  if (runtimeStartIdx !== -1 && runtimeEndIdx !== -1) {
    const lineStart = result.lastIndexOf('\n', runtimeStartIdx);
    const lineEnd = result.indexOf('\n', runtimeEndIdx + MARKERS.RUNTIME_END.length);
    result =
      result.slice(0, lineStart === -1 ? 0 : lineStart) +
      result.slice(lineEnd === -1 ? result.length : lineEnd);
  }

  // Remove ALL body sections (multi-workflow files have multiple)
  while (true) {
    const bodyStartIdx = result.indexOf(MARKERS.BODY_START);
    const bodyEndIdx = result.indexOf(MARKERS.BODY_END);
    if (bodyStartIdx === -1 || bodyEndIdx === -1 || bodyEndIdx < bodyStartIdx) break;
    const before = result.slice(0, bodyStartIdx);
    const after = result.slice(bodyEndIdx + MARKERS.BODY_END.length);
    result = before + `throw new Error('Not implemented');` + after;
  }

  return result;
}
