import { describe, it, expect } from 'vitest';
import type { TNodeTypeAST } from '../../src/ast/types';

describe('TNodeTypeAST importSource field', () => {
  it('accepts importSource on a node type', () => {
    const nodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'format',
      functionName: 'format',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
      importSource: 'date-fns',
    };

    expect(nodeType.importSource).toBe('date-fns');
  });

  it('importSource is optional (backward compatible)', () => {
    const nodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'add',
      functionName: 'add',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    expect(nodeType.importSource).toBeUndefined();
  });
});
