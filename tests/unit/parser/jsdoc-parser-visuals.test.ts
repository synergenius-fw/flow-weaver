/**
 * Tests that @color and @icon annotations on @flowWeaver nodeType
 * are parsed into the config and surface as visuals on the AST.
 */
import { jsdocParser } from '../../../src/parser/jsdoc-parser';
import { extractFunctionLikes } from '../../../src/parser/function-like';
import { getSharedProject } from '../../../src/parser/shared-project';
import { parser } from '../../../src/parser/annotation-parser';

describe('@color and @icon on nodeType', () => {
  const project = getSharedProject();

  it('parseNodeType extracts @color and @icon into config', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @expression
 * @color teal
 * @icon ai
 */
function shout(text: string): { result: string } {
  return { result: text.toUpperCase() + '!!!' };
}
`;
    const sourceFile = project.createSourceFile('visuals-test.ts', code, { overwrite: true });
    const functions = extractFunctionLikes(sourceFile);
    expect(functions.length).toBe(1);

    const warnings: string[] = [];
    const config = jsdocParser.parseNodeType(functions[0], warnings);

    expect(config).not.toBeNull();
    expect(config!.color).toBe('teal');
    expect(config!.icon).toBe('ai');
  });

  it('parser produces visuals on the node type AST', () => {
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @expression
 * @color teal
 * @icon ai
 */
function shout(text: string): { result: string } {
  return { result: text.toUpperCase() + '!!!' };
}
`);
    const nt = result.nodeTypes.find(n => n.functionName === 'shout');
    expect(nt).toBeDefined();
    expect(nt!.visuals).toBeDefined();
    expect(nt!.visuals?.color).toBe('teal');
    expect(nt!.visuals?.icon).toBe('ai');
  });

  it('parser produces visuals with only @color', () => {
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @expression
 * @color orange
 */
function greet(name: string): { greeting: string } {
  return { greeting: 'hi ' + name };
}
`);
    const nt = result.nodeTypes.find(n => n.functionName === 'greet');
    expect(nt!.visuals).toBeDefined();
    expect(nt!.visuals?.color).toBe('orange');
    expect(nt!.visuals?.icon).toBeUndefined();
  });

  it('parser produces visuals with only @icon', () => {
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @expression
 * @icon biotech
 */
function process(input: string): { output: string } {
  return { output: input };
}
`);
    const nt = result.nodeTypes.find(n => n.functionName === 'process');
    expect(nt!.visuals).toBeDefined();
    expect(nt!.visuals?.icon).toBe('biotech');
    expect(nt!.visuals?.color).toBeUndefined();
  });

  it('no visuals when @color and @icon are absent', () => {
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @expression
 */
function plain(x: string): { y: string } {
  return { y: x };
}
`);
    const nt = result.nodeTypes.find(n => n.functionName === 'plain');
    expect(nt!.visuals).toBeUndefined();
  });
});
