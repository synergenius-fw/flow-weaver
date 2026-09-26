/**
 * The generated module's text and its source map.
 *
 * Decides the generated line each appended piece of text starts on, so a
 * source mapping can point that line back at the workflow source. A mapping
 * is only recorded when a source map was requested and the workflow has a
 * source file.
 */

import { SourceMapGenerator } from 'source-map';

export class ModuleWriter {
  private readonly lines: string[] = [];
  /** The 1-based generated line the next appended text starts on. */
  private currentLine = 1;
  private readonly sourceMap: SourceMapGenerator | undefined;

  constructor(
    workflowFunctionName: string,
    private readonly sourceFile: string | undefined,
    withSourceMap: boolean,
  ) {
    this.sourceMap = withSourceMap
      ? new SourceMapGenerator({ file: `${workflowFunctionName}.generated.ts` })
      : undefined;
  }

  /** Whether mappings are being recorded (a source map was asked for and there is a source file). */
  get mapsSource(): boolean {
    return this.sourceMap !== undefined && Boolean(this.sourceFile);
  }

  /**
   * Appends a chunk of generated text, which may span several lines. Only
   * `\n` ends a line: the chunk is joined with `\n`, so that is what the
   * generated line numbers count.
   */
  push(chunk: string): void {
    this.lines.push(chunk);
    this.currentLine += chunk.split('\n').length;
  }

  /** Maps the line the next appended text starts on to a line of the workflow source. */
  map(sourceLine: number, sourceColumn: number = 0): void {
    if (this.sourceMap && this.sourceFile) {
      this.sourceMap.addMapping({
        generated: {
          line: this.currentLine,
          column: 0,
        },
        source: this.sourceFile,
        original: {
          line: sourceLine,
          column: sourceColumn,
        },
      });
    }
  }

  /** The module text. */
  text(): string {
    return this.lines.join('\n');
  }

  /**
   * The finished source map, with the workflow source's content embedded, or
   * undefined when none was asked for.
   */
  finishSourceMap(readSource: (file: string) => string): string | undefined {
    if (!this.sourceMap) return undefined;
    if (this.sourceFile) {
      this.sourceMap.setSourceContent(this.sourceFile, readSource(this.sourceFile));
    }
    return this.sourceMap.toString();
  }
}
