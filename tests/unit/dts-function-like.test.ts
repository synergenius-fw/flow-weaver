import { describe, it, expect } from 'vitest';
import { extractFunctionLikes } from '../../src/function-like';
import { getSharedProject } from '../../src/shared-project';

describe('extractFunctionLikes with .d.ts content', () => {
  const project = getSharedProject();

  function createDtsFile(content: string) {
    const existing = project.getSourceFile('test.d.ts');
    if (existing) project.removeSourceFile(existing);
    return project.createSourceFile('test.d.ts', content, { overwrite: true });
  }

  it('finds declare function in .d.ts content', () => {
    const sf = createDtsFile(`
      export declare function format(date: Date, formatStr: string): string;
      export declare function addDays(date: Date, amount: number): Date;
    `);
    const fns = extractFunctionLikes(sf);
    expect(fns).toHaveLength(2);
    expect(fns[0].getName()).toBe('format');
    expect(fns[1].getName()).toBe('addDays');
  });

  it('getParameters() returns correct param names and types', () => {
    const sf = createDtsFile(`
      export declare function format(date: Date, formatStr: string): string;
    `);
    const fns = extractFunctionLikes(sf);
    const params = fns[0].getParameters();
    expect(params).toHaveLength(2);
    expect(params[0].getName()).toBe('date');
    expect(params[1].getName()).toBe('formatStr');
    expect(params[1].getType().getText()).toBe('string');
  });

  it('getReturnType() returns correct type including Promise<T>', () => {
    const sf = createDtsFile(`
      export declare function fetchData(url: string): Promise<string>;
    `);
    const fns = extractFunctionLikes(sf);
    const returnType = fns[0].getReturnType();
    expect(returnType.getText()).toContain('Promise');
    const typeArgs = returnType.getTypeArguments();
    expect(typeArgs).toHaveLength(1);
    expect(typeArgs[0].getText()).toBe('string');
  });

  it('handles overloaded declarations', () => {
    const sf = createDtsFile(`
      export declare function convert(input: string): number;
      export declare function convert(input: number): string;
    `);
    const fns = extractFunctionLikes(sf);
    // ts-morph returns each overload as a separate FunctionDeclaration
    expect(fns.length).toBeGreaterThanOrEqual(1);
    // At minimum, we should be able to extract one signature
    expect(fns[0].getName()).toBe('convert');
  });

  it('handles generic functions — type params resolve to something', () => {
    const sf = createDtsFile(`
      export declare function identity<T>(input: T): T;
    `);
    const fns = extractFunctionLikes(sf);
    expect(fns).toHaveLength(1);
    expect(fns[0].getName()).toBe('identity');
    const params = fns[0].getParameters();
    expect(params).toHaveLength(1);
    expect(params[0].getName()).toBe('input');
  });

  it('getText() returns declaration text (no body)', () => {
    const sf = createDtsFile(`
      export declare function format(date: Date): string;
    `);
    const fns = extractFunctionLikes(sf);
    const text = fns[0].getText();
    expect(text).toContain('declare function format');
    expect(text).not.toContain('{');
  });

  it('isAsync returns false for declare function (not async keyword)', () => {
    const sf = createDtsFile(`
      export declare function fetchData(url: string): Promise<string>;
    `);
    const fns = extractFunctionLikes(sf);
    // declare function cannot use async keyword; isAsync should be false
    expect(fns[0].isAsync()).toBe(false);
  });
});
