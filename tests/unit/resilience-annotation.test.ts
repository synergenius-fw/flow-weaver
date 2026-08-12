import { parser } from '../../src/parser';
import { jsdocParser } from '../../src/jsdoc-parser';
import { extractFunctionLikes } from '../../src/function-like';
import { getSharedProject } from '../../src/shared-project';

describe('@resilience node contract', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @resilience retries=3 fallback="anthropic-backup"
 * @input execute
 * @output onSuccess
 * @output onFailure
 */
async function callLlm(execute: boolean) {
  return { onSuccess: execute, onFailure: false };
}
`;

  it('parses the declared retry and fallback settings', () => {
    const file = getSharedProject().createSourceFile('resilience-contract.ts', source, {
      overwrite: true,
    });
    const warnings: string[] = [];
    const config = jsdocParser.parseNodeType(extractFunctionLikes(file)[0], warnings);

    expect(warnings).toEqual([]);
    expect(config?.resilience).toEqual({ retries: 3, fallback: 'anthropic-backup' });
  });

  it('surfaces the contract on the node type AST', () => {
    const result = parser.parseFromString(source);
    expect(result.nodeTypes.find((node) => node.name === 'callLlm')?.resilience).toEqual({
      retries: 3,
      fallback: 'anthropic-backup',
    });
  });

  it('rejects invalid retry counts', () => {
    const file = getSharedProject().createSourceFile(
      'resilience-invalid.ts',
      source.replace('retries=3', 'retries=0'),
      { overwrite: true },
    );
    const warnings: string[] = [];
    const config = jsdocParser.parseNodeType(extractFunctionLikes(file)[0], warnings);

    expect(config?.resilience).toEqual({ fallback: 'anthropic-backup' });
    expect(warnings).toContain('@resilience retries must be a positive integer.');
  });
});
