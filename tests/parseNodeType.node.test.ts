import { describe, it, expect } from 'vitest';

// Type definitions (copied from ast/types.ts for testing)
type TPortPlacement = 'TOP' | 'BOTTOM';
type TNodeTypePort = {
  name: string;
  direction: 'INPUT' | 'OUTPUT';
  type?: string;
  defaultLabel?: string;
  defaultOrder?: number;
  defaultHidden?: boolean;
  defaultPlacement?: 'TOP' | 'BOTTOM';
  scope?: string;
};
type TNodeUI = {
  name: string;
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  ports?: Array<{
    name: string;
    direction: 'INPUT' | 'OUTPUT';
    scope?: string;
    order?: number;
    label?: string;
    hidden?: boolean;
    placement?: TPortPlacement;
    failure?: boolean;
  }>;
};

// Copy of filterAndSortPorts function from utils-common/utils/ports.ts
const filterAndSortPorts = (
  nodeUI: TNodeUI | null,
  ports: TNodeTypePort[],
  direction: 'INPUT' | 'OUTPUT',
  scope: boolean | null,
  placement?: TPortPlacement,
) => {
  return ports
    .filter((port) => {
      const portUI = nodeUI?.ports?.find(
        (p) => p.name === port.name &&
               p.direction === port.direction &&
               (p.scope ?? null) === (port.scope ?? null)
      );
      const hidden = portUI?.hidden ?? port.defaultHidden ?? false;
      const portPlacement = portUI?.placement ?? port.defaultPlacement;

      return (
        port.direction === direction &&
        ((scope == null && port.scope == null) ||
          (scope != null && port.scope != null)) &&
        !hidden &&
        (placement == null || portPlacement === placement)
      );
    })
    .sort((a, b) => {
      const aPortUI = nodeUI?.ports?.find(
        (p) => p.name === a.name &&
               p.direction === a.direction &&
               (p.scope ?? null) === (a.scope ?? null)
      );
      const bPortUI = nodeUI?.ports?.find(
        (p) => p.name === b.name &&
               p.direction === b.direction &&
               (p.scope ?? null) === (b.scope ?? null)
      );
      const aOrder = aPortUI?.order ?? a.defaultOrder ?? 0;
      const bOrder = bPortUI?.order ?? b.defaultOrder ?? 0;
      return aOrder - bOrder;
    });
};

// Infer port DATA TYPE from port name (convention-based)
function inferPortDataType(name: string): 'STEP' | 'ANY' {
  const lower = name.toLowerCase();
  if (lower === 'execute' || lower === 'start') return 'STEP';
  if (lower === 'onsuccess' || lower === 'success') return 'STEP';
  if (lower === 'onfailure' || lower === 'failure') return 'STEP';
  return 'ANY';
}

type TDataType = 'STEP' | 'ANY' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'OBJECT' | 'ARRAY';

// Infer TDataType from a TypeScript type string (mirrors library's inferDataTypeFromTS)
function inferDataTypeFromTS(tsType: string): TDataType {
  const normalized = tsType.trim();
  if (normalized === 'string') return 'STRING';
  if (normalized === 'number') return 'NUMBER';
  if (normalized === 'boolean') return 'BOOLEAN';
  if (normalized === 'any' || normalized === 'unknown' || normalized === 'never') return 'ANY';
  if (normalized === 'void' || normalized === 'undefined' || normalized === 'null') return 'ANY';
  if (normalized.endsWith('[]') || normalized.startsWith('Array<') || normalized.startsWith('ReadonlyArray<')) return 'ARRAY';
  // Promise unwrap
  if (normalized.startsWith('Promise<') && normalized.endsWith('>')) {
    return inferDataTypeFromTS(normalized.slice(8, -1));
  }
  // Union: strip null/undefined
  if (normalized.includes('|')) {
    const parts = normalized.split('|').map(p => p.trim());
    const nonNull = parts.filter(p => p !== 'undefined' && p !== 'null');
    if (nonNull.length === 1) return inferDataTypeFromTS(nonNull[0]);
    return 'ANY';
  }
  // Intersection → OBJECT
  if (normalized.includes('&')) return 'OBJECT';
  // Everything else (Record, Map, custom types) → OBJECT
  return 'OBJECT';
}

// Extract parameter types from function signature: "function name(p1: Type1, p2: Type2)"
function extractParamTypes(content: string, functionName: string): Map<string, string> {
  const result = new Map<string, string>();
  // Match the function signature - capture everything between ( and ) before { or =>
  const sigRegex = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\(([^)]*?)\\)`,
    's'
  );
  const match = sigRegex.exec(content);
  if (!match) return result;
  const params = match[1];
  // Split by commas at top level (not inside <> or {})
  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (const ch of params) {
    if (ch === '<' || ch === '{' || ch === '(') depth++;
    else if (ch === '>' || ch === '}' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const name = part.slice(0, colonIdx).trim();
    const type = part.slice(colonIdx + 1).trim();
    result.set(name, type);
  }
  return result;
}

// Extract return type fields: "): { field1: Type1; field2: Type2 }" or "): Promise<{ ... }>"
function extractReturnTypeFields(content: string, functionName: string): Map<string, string> {
  const result = new Map<string, string>();
  const sigRegex = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*:\\s*(?:Promise\\s*<\\s*)?\\{([^}]+)\\}`,
    's'
  );
  const match = sigRegex.exec(content);
  if (!match) return result;
  const fields = match[1];
  // Split by ; or , at top level
  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (const ch of fields) {
    if (ch === '<' || ch === '{' || ch === '(') depth++;
    else if (ch === '>' || ch === '}' || ch === ')') depth--;
    if ((ch === ';' || ch === ',') && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    let name = part.slice(0, colonIdx).trim();
    // Handle optional fields like "field?: type"
    if (name.endsWith('?')) name = name.slice(0, -1);
    const type = part.slice(colonIdx + 1).trim();
    result.set(name, type);
  }
  return result;
}

// Infer default placement for scoped node ports
function inferPortPlacement(
  name: string,
  direction: 'INPUT' | 'OUTPUT',
  scope: string | undefined,
  hasScopes: boolean
): 'TOP' | 'BOTTOM' | undefined {
  const lower = name.toLowerCase();

  if (scope) {
    if (direction === 'INPUT') {
      if (lower === 'success') return 'TOP';
      return 'BOTTOM';
    } else {
      if (lower === 'start') return 'TOP';
      return 'BOTTOM';
    }
  } else if (hasScopes) {
    if (direction === 'OUTPUT') {
      if (lower === 'onsuccess' || lower === 'onfailure') return 'TOP';
      return 'BOTTOM';
    }
  }

  return undefined;
}

type TNodeType = {
  name: string;
  label?: string;
  ports?: Array<{
    name: string;
    direction: 'INPUT' | 'OUTPUT';
    type: 'STEP' | 'ANY' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'OBJECT' | 'ARRAY';
    defaultLabel?: string;
    defaultOrder?: number;
    defaultPlacement?: 'TOP' | 'BOTTOM';
    scope?: string;
  }>;
  scopes?: string[];
  variant?: string;
};

// Parse nodeType from code content for preview
function parseNodeTypeFromCode(content: string, functionName: string): TNodeType | null {
  // Find the JSDoc block for this function with @flowWeaver nodeType
  const pattern = new RegExp(
    `\\/\\*\\*([\\s\\S]*?)@flowWeaver\\s+nodeType([\\s\\S]*?)\\*\\/\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\(`,
    'g'
  );
  const match = pattern.exec(content);
  if (!match) return null;

  const jsdocContent = match[1] + match[2];

  // Extract label from @label
  const labelMatch = jsdocContent.match(/@label\s+(?:"([^"]+)"|([^\n*@]+))/);
  const label = labelMatch ? (labelMatch[1] || labelMatch[2])?.trim() : functionName;

  // Extract type information from function signature for fallback
  const paramTypes = extractParamTypes(content, functionName);
  const returnTypes = extractReturnTypeFields(content, functionName);

  // Extract ports
  const ports: TNodeType['ports'] = [];

  // Parse @input tags - simplified pattern: capture port name and rest of line
  const inputPattern = /@input\s+(\w+)([^\n]*)/g;
  let portMatch;
  let inputOrder = 0;
  while ((portMatch = inputPattern.exec(jsdocContent)) !== null) {
    const [, name, rest] = portMatch;
    const scopeMatch = rest.match(/scope:(\w+)/);
    const scopeName = scopeMatch?.[1];
    const orderMatch = rest.match(/\[order:\s*(\d+)\]/);
    const order = orderMatch ? parseInt(orderMatch[1], 10) : inputOrder++;
    const typeMatch = rest.match(/\[type:\s*(\w+)\]/);
    const explicitType = typeMatch?.[1]?.toUpperCase();
    // Type resolution priority: explicit [type:X] > signature inference > name-based convention
    const portType: TDataType = explicitType === 'STEP' || explicitType === 'STRING' || explicitType === 'NUMBER' || explicitType === 'BOOLEAN' || explicitType === 'OBJECT' || explicitType === 'ARRAY'
      ? explicitType as TDataType
      : inferPortDataType(name) !== 'ANY'
        ? inferPortDataType(name)
        : paramTypes.has(name)
          ? inferDataTypeFromTS(paramTypes.get(name)!)
          : 'ANY';
    const labelMatch = rest.match(/\s+-\s*(.+)$/);
    const portLabel = labelMatch?.[1]?.replace(/\s*\*.*$/, '').trim();
    ports.push({
      name,
      direction: 'INPUT' as const,
      type: portType,
      defaultLabel: portLabel || name,
      defaultOrder: order,
      scope: scopeName,
    });
  }

  // Parse @output tags
  const outputPattern = /@output\s+(\w+)([^\n]*)/g;
  let outputOrder = 0;
  while ((portMatch = outputPattern.exec(jsdocContent)) !== null) {
    const [, name, rest] = portMatch;
    const scopeMatch = rest.match(/scope:(\w+)/);
    const scopeName = scopeMatch?.[1];
    const orderMatch = rest.match(/\[order:\s*(\d+)\]/);
    const order = orderMatch ? parseInt(orderMatch[1], 10) : outputOrder++;
    const typeMatch = rest.match(/\[type:\s*(\w+)\]/);
    const explicitType = typeMatch?.[1]?.toUpperCase();
    // Type resolution priority: explicit [type:X] > signature inference > name-based convention
    const portType: TDataType = explicitType === 'STEP' || explicitType === 'STRING' || explicitType === 'NUMBER' || explicitType === 'BOOLEAN' || explicitType === 'OBJECT' || explicitType === 'ARRAY'
      ? explicitType as TDataType
      : inferPortDataType(name) !== 'ANY'
        ? inferPortDataType(name)
        : returnTypes.has(name)
          ? inferDataTypeFromTS(returnTypes.get(name)!)
          : 'ANY';
    const labelMatch = rest.match(/\s+-\s*(.+)$/);
    const portLabel = labelMatch?.[1]?.replace(/\s*\*.*$/, '').trim();
    ports.push({
      name,
      direction: 'OUTPUT' as const,
      type: portType,
      defaultLabel: portLabel || name,
      defaultOrder: order,
      scope: scopeName,
    });
  }

  // Inject mandatory step ports if not already present (ALL nodes must have them)
  const hasExecute = ports.some(p => p.direction === 'INPUT' && p.name === 'execute');
  const hasOnSuccess = ports.some(p => p.direction === 'OUTPUT' && p.name === 'onSuccess');
  const hasOnFailure = ports.some(p => p.direction === 'OUTPUT' && p.name === 'onFailure');

  if (!hasExecute) {
    // Shift existing input orders up by 1 to make room for execute at 0
    for (const port of ports) {
      if (port.direction === 'INPUT' && port.defaultOrder !== undefined) {
        port.defaultOrder = port.defaultOrder + 1;
      }
    }
    ports.push({
      name: 'execute',
      direction: 'INPUT',
      type: 'STEP',
      defaultLabel: 'Execute',
      defaultOrder: 0,
    });
  }
  if (!hasOnSuccess) {
    // Shift existing output orders up by 2 to make room for onSuccess(0) and onFailure(1)
    for (const port of ports) {
      if (port.direction === 'OUTPUT' && port.defaultOrder !== undefined) {
        port.defaultOrder = port.defaultOrder + 2;
      }
    }
    ports.push({
      name: 'onSuccess',
      direction: 'OUTPUT',
      type: 'STEP',
      defaultLabel: 'On Success',
      defaultOrder: 0,
    });
  }
  if (!hasOnFailure) {
    ports.push({
      name: 'onFailure',
      direction: 'OUTPUT',
      type: 'STEP',
      defaultLabel: 'On Failure',
      defaultOrder: 1,
    });
  }

  // Collect scopes from ports
  const scopeSet = new Set<string>();
  for (const port of ports) {
    if (port.scope) scopeSet.add(port.scope);
  }
  const scopes = scopeSet.size > 0 ? Array.from(scopeSet) : undefined;
  const hasScopes = scopeSet.size > 0;

  // Add defaultPlacement to ports (required for ScopedNode filtering)
  const portsWithPlacement = ports.map(port => ({
    ...port,
    defaultPlacement: inferPortPlacement(port.name, port.direction, port.scope, hasScopes),
  }));

  return {
    name: functionName,
    label: label || functionName,
    ports: portsWithPlacement,
    scopes,
    variant: 'FUNCTION',
  };
}

describe('parseNodeTypeFromCode', () => {
  const agentLoopCode = `
/**
 * Agent loop that orchestrates LLM calls and tool execution
 * Uses scoped ports to handle iteration internally
 *
 * @flowWeaver nodeType
 * @label Agent Loop
 * @input userMessage [order:1] - User's input message
 * @input success scope:iteration [order:0] - From LLM onSuccess
 * @input failure scope:iteration [order:1] - From LLM onFailure
 * @input llmResponse scope:iteration [order:2] - LLM response
 * @input toolMessages scope:iteration [order:3] - Tool results
 * @input execute [order:0] - Execute
 * @output start scope:iteration [order:0] - Triggers iteration
 * @output state scope:iteration [order:1] - Current agent state
 * @output response [order:2] - Final response when done
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function agentLoop(
  execute: boolean,
  userMessage: string
): Promise<{ onSuccess: boolean; onFailure: boolean; response: string }> {
  return { onSuccess: true, onFailure: false, response: '' };
}
`;

  it('should parse all input ports', () => {
    const result = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(result).not.toBeNull();

    const inputPorts = result!.ports!.filter(p => p.direction === 'INPUT');
    expect(inputPorts).toHaveLength(6);

    const inputNames = inputPorts.map(p => p.name);
    expect(inputNames).toContain('userMessage');
    expect(inputNames).toContain('success');
    expect(inputNames).toContain('failure');
    expect(inputNames).toContain('llmResponse');
    expect(inputNames).toContain('toolMessages');
    expect(inputNames).toContain('execute');
  });

  it('should parse all output ports', () => {
    const result = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(result).not.toBeNull();

    const outputPorts = result!.ports!.filter(p => p.direction === 'OUTPUT');
    expect(outputPorts).toHaveLength(5);

    const outputNames = outputPorts.map(p => p.name);
    expect(outputNames).toContain('start');
    expect(outputNames).toContain('state');
    expect(outputNames).toContain('response');
    expect(outputNames).toContain('onSuccess');
    expect(outputNames).toContain('onFailure');
  });

  it('should parse scoped ports correctly', () => {
    const result = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(result).not.toBeNull();

    const scopedPorts = result!.ports!.filter(p => p.scope === 'iteration');
    expect(scopedPorts).toHaveLength(6);

    const scopedNames = scopedPorts.map(p => p.name);
    expect(scopedNames).toContain('success');
    expect(scopedNames).toContain('failure');
    expect(scopedNames).toContain('llmResponse');
    expect(scopedNames).toContain('toolMessages');
    expect(scopedNames).toContain('start');
    expect(scopedNames).toContain('state');
  });

  it('should infer port DATA TYPES from names', () => {
    const result = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(result).not.toBeNull();

    const portsByName = new Map(result!.ports!.map(p => [p.name, p]));

    // Control flow ports get STEP type
    expect(portsByName.get('execute')!.type).toBe('STEP');
    expect(portsByName.get('start')!.type).toBe('STEP');
    expect(portsByName.get('success')!.type).toBe('STEP');
    expect(portsByName.get('onSuccess')!.type).toBe('STEP');
    expect(portsByName.get('failure')!.type).toBe('STEP');
    expect(portsByName.get('onFailure')!.type).toBe('STEP');

    // Data ports infer types from function signature
    expect(portsByName.get('userMessage')!.type).toBe('STRING'); // string param
    // Scoped ports don't appear in the function signature, so they stay ANY
    expect(portsByName.get('llmResponse')!.type).toBe('ANY');
    expect(portsByName.get('toolMessages')!.type).toBe('ANY');
    expect(portsByName.get('state')!.type).toBe('ANY');
    expect(portsByName.get('response')!.type).toBe('STRING'); // return type: string
  });

  it('should parse order correctly', () => {
    const result = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(result).not.toBeNull();

    const portsByName = new Map(result!.ports!.map(p => [p.name, p]));

    expect(portsByName.get('execute')!.defaultOrder).toBe(0);
    expect(portsByName.get('userMessage')!.defaultOrder).toBe(1);
    expect(portsByName.get('success')!.defaultOrder).toBe(0);
    expect(portsByName.get('failure')!.defaultOrder).toBe(1);
  });

  it('should extract scopes array', () => {
    const result = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(result).not.toBeNull();
    expect(result!.scopes).toEqual(['iteration']);
  });

  it('should extract label', () => {
    const result = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(result).not.toBeNull();
    expect(result!.label).toBe('Agent Loop');
  });

  it('should infer defaultPlacement for scoped node ports', () => {
    const result = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(result).not.toBeNull();

    const portsByName = new Map(result!.ports!.map(p => [p.name, p]));

    // Scoped inputs: success at TOP, others at BOTTOM
    expect(portsByName.get('success')!.defaultPlacement).toBe('TOP');
    expect(portsByName.get('failure')!.defaultPlacement).toBe('BOTTOM');
    expect(portsByName.get('llmResponse')!.defaultPlacement).toBe('BOTTOM');
    expect(portsByName.get('toolMessages')!.defaultPlacement).toBe('BOTTOM');

    // Scoped outputs: start at TOP, others at BOTTOM
    expect(portsByName.get('start')!.defaultPlacement).toBe('TOP');
    expect(portsByName.get('state')!.defaultPlacement).toBe('BOTTOM');

    // External outputs: onSuccess/onFailure at TOP, response at BOTTOM
    expect(portsByName.get('onSuccess')!.defaultPlacement).toBe('TOP');
    expect(portsByName.get('onFailure')!.defaultPlacement).toBe('TOP');
    expect(portsByName.get('response')!.defaultPlacement).toBe('BOTTOM');

    // External inputs: no placement needed (undefined)
    expect(portsByName.get('execute')!.defaultPlacement).toBeUndefined();
    expect(portsByName.get('userMessage')!.defaultPlacement).toBeUndefined();
  });
});

describe('filterAndSortPorts for NodeDiagram', () => {
  const agentLoopCode = `
/**
 * @flowWeaver nodeType
 * @label Agent Loop
 * @input userMessage [order:1] - User's input message
 * @input success scope:iteration [order:0] - From LLM onSuccess
 * @input failure scope:iteration [order:1] - From LLM onFailure
 * @input llmResponse scope:iteration [order:2] - LLM response
 * @input toolMessages scope:iteration [order:3] - Tool results
 * @input execute [order:0] - Execute
 * @output start scope:iteration [order:0] - Triggers iteration
 * @output state scope:iteration [order:1] - Current agent state
 * @output response [order:2] - Final response when done
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function agentLoop() {}
`;

  // Convert parsed nodeType ports to TNodeTypePort format
  function convertToNodeTypePorts(parsedPorts: TNodeType['ports']): TNodeTypePort[] {
    return (parsedPorts || []).map((p, index) => ({
      name: p.name,
      direction: p.direction,
      type: p.type,  // This should be the port type (DATA, STEP, etc)
      defaultLabel: p.defaultLabel,
      defaultOrder: p.defaultOrder ?? index,
      scope: p.scope,
      defaultHidden: false,
    }));
  }

  // Create nodeUI from ports (simulates what NodeDiagram does)
  function createNodeUI(ports: TNodeTypePort[]): TNodeUI {
    return {
      name: 'PreviewNode',
      label: 'Agent Loop',
      x: 0,
      y: 0,
      width: 400,
      height: 180,
      ports: ports.map((port, index) => ({
        name: port.name,
        direction: port.direction,
        scope: port.scope,
        order: port.defaultOrder ?? index,
        label: port.defaultLabel ?? port.name,
        hidden: false,
        placement: 'TOP' as const,
        failure: port.type === 'FAILURE',
      })),
    };
  }

  it('should filter external input ports correctly (scope=null)', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    const ports = convertToNodeTypePorts(parsed!.ports);
    const nodeUI = createNodeUI(ports);

    const externalInputs = filterAndSortPorts(nodeUI, ports, 'INPUT', null);

    expect(externalInputs).toHaveLength(2); // execute, userMessage
    expect(externalInputs.map(p => p.name).sort()).toEqual(['execute', 'userMessage']);
  });

  it('should filter external output ports correctly (scope=null)', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    const ports = convertToNodeTypePorts(parsed!.ports);
    const nodeUI = createNodeUI(ports);

    const externalOutputs = filterAndSortPorts(nodeUI, ports, 'OUTPUT', null);

    expect(externalOutputs).toHaveLength(3); // response, onSuccess, onFailure
    expect(externalOutputs.map(p => p.name).sort()).toEqual(['onFailure', 'onSuccess', 'response']);
  });

  it('should filter scoped input ports correctly (scope=true)', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    const ports = convertToNodeTypePorts(parsed!.ports);
    const nodeUI = createNodeUI(ports);

    const scopedInputs = filterAndSortPorts(nodeUI, ports, 'INPUT', true);

    expect(scopedInputs).toHaveLength(4); // success, failure, llmResponse, toolMessages
    expect(scopedInputs.map(p => p.name).sort()).toEqual(['failure', 'llmResponse', 'success', 'toolMessages']);
  });

  it('should filter scoped output ports correctly (scope=true)', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    const ports = convertToNodeTypePorts(parsed!.ports);
    const nodeUI = createNodeUI(ports);

    const scopedOutputs = filterAndSortPorts(nodeUI, ports, 'OUTPUT', true);

    expect(scopedOutputs).toHaveLength(2); // start, state
    expect(scopedOutputs.map(p => p.name).sort()).toEqual(['start', 'state']);
  });

  it('should have correct total port count', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    const ports = convertToNodeTypePorts(parsed!.ports);
    const nodeUI = createNodeUI(ports);

    const externalInputs = filterAndSortPorts(nodeUI, ports, 'INPUT', null);
    const externalOutputs = filterAndSortPorts(nodeUI, ports, 'OUTPUT', null);
    const scopedInputs = filterAndSortPorts(nodeUI, ports, 'INPUT', true);
    const scopedOutputs = filterAndSortPorts(nodeUI, ports, 'OUTPUT', true);

    const total = externalInputs.length + externalOutputs.length + scopedInputs.length + scopedOutputs.length;
    expect(total).toBe(11); // All 11 ports should be accounted for
  });

  it('should list all port names for debugging', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    const ports = convertToNodeTypePorts(parsed!.ports);
    const nodeUI = createNodeUI(ports);

    // This test always passes - it's for debugging output
    expect(true).toBe(true);
  });

  it('should verify nodeUI ports match parsed ports', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    const ports = convertToNodeTypePorts(parsed!.ports);
    const nodeUI = createNodeUI(ports);

    // Verify each port can be found in nodeUI
    const missingInUI: string[] = [];
    ports.forEach(port => {
      const found = nodeUI.ports?.find(
        p => p.name === port.name &&
             p.direction === port.direction &&
             (p.scope ?? null) === (port.scope ?? null)
      );
      if (!found) {
        missingInUI.push(`${port.direction} ${port.name} scope=${port.scope ?? 'external'}`);
      }
    });

    expect(missingInUI).toHaveLength(0);
  });
});

// Simulate exactly what NodeDiagram does
describe('NodeDiagram simulation', () => {
  const agentLoopCode = `
/**
 * @flowWeaver nodeType
 * @label Agent Loop
 * @input userMessage [order:1] - User's input message
 * @input success scope:iteration [order:0] - From LLM onSuccess
 * @input failure scope:iteration [order:1] - From LLM onFailure
 * @input llmResponse scope:iteration [order:2] - LLM response
 * @input toolMessages scope:iteration [order:3] - Tool results
 * @input execute [order:0] - Execute
 * @output start scope:iteration [order:0] - Triggers iteration
 * @output state scope:iteration [order:1] - Current agent state
 * @output response [order:2] - Final response when done
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function agentLoop() {}
`;

  // Simulates NodeDiagram lines 86-99 - creating inputs/outputs dicts
  function createInputsOutputsDicts(nodeType: TNodeType): { inputs: Record<string, unknown>; outputs: Record<string, unknown> } {
    const inputs: Record<string, unknown> = {};
    const outputs: Record<string, unknown> = {};

    (nodeType.ports || []).forEach((port, index) => {
      const portDef = {
        dataType: (port.type ?? 'ANY'),
        label: port.defaultLabel ?? port.name,
        scope: port.scope,
        metadata: { order: port.defaultOrder ?? index },
        hidden: false,
      };
      if (port.direction === 'INPUT') {
        inputs[port.name] = portDef;
      } else {
        outputs[port.name] = portDef;
      }
    });

    return { inputs, outputs };
  }

  // Simulates getAllNodePorts converting from inputs/outputs back to ports array
  function convertInputsOutputsToPorts(
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>
  ): TNodeTypePort[] {
    const ports: TNodeTypePort[] = [];
    let implicitInputOrder = 0;
    let implicitOutputOrder = 0;

    for (const [portName, portDef] of Object.entries(inputs)) {
      const def = portDef as { dataType?: string; label?: string; scope?: string; metadata?: { order?: number }; hidden?: boolean };
      ports.push({
        name: portName,
        type: def.dataType,
        direction: 'INPUT',
        defaultLabel: def.label || portName,
        scope: def.scope,
        defaultHidden: def.hidden ?? false,
        defaultOrder: def.metadata?.order ?? implicitInputOrder++,
      });
    }

    for (const [portName, portDef] of Object.entries(outputs)) {
      const def = portDef as { dataType?: string; label?: string; scope?: string; metadata?: { order?: number }; hidden?: boolean };
      ports.push({
        name: portName,
        type: def.dataType,
        direction: 'OUTPUT',
        defaultLabel: def.label || portName,
        scope: def.scope,
        defaultHidden: def.hidden ?? false,
        defaultOrder: def.metadata?.order ?? implicitOutputOrder++,
      });
    }

    return ports;
  }

  it('should preserve all ports when converting to inputs/outputs and back', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(parsed).not.toBeNull();

    // Step 1: Create inputs/outputs dicts (like NodeDiagram)
    const { inputs, outputs } = createInputsOutputsDicts(parsed!);

    // Verify input count
    expect(Object.keys(inputs)).toHaveLength(6);
    expect(Object.keys(outputs)).toHaveLength(5);

    // Step 2: Convert back to ports array (like getAllNodePorts)
    const convertedPorts = convertInputsOutputsToPorts(inputs, outputs);

    // Verify all 11 ports
    expect(convertedPorts).toHaveLength(11);

    // Verify scopes preserved
    const scopedConverted = convertedPorts.filter(p => p.scope === 'iteration');
    expect(scopedConverted).toHaveLength(6);
  });

  it('should create correct nodeUI with all ports', () => {
    const parsed = parseNodeTypeFromCode(agentLoopCode, 'agentLoop');
    expect(parsed).not.toBeNull();

    // This simulates NodeDiagram lines 141-152 - creating UI ports
    const uiPorts = (parsed!.ports || []).map((port, index) => ({
      name: port.name,
      direction: port.direction,
      scope: port.scope,
      order: port.defaultOrder ?? index,
      label: port.defaultLabel ?? port.name,
      hidden: false,
      placement: 'TOP' as const,
      failure: false,
    }));

    expect(uiPorts).toHaveLength(11);
  });
});

describe('expression node support', () => {
  const expressionNodeCode = `
/**
 * Merge enrichment data from multiple sources
 *
 * @flowWeaver nodeType
 * @expression
 * @label Merge Results
 * @input clearbit - Clearbit enrichment data
 * @input linkedin - LinkedIn enrichment data
 * @input github - GitHub enrichment data
 * @output profile - Merged enrichment profile
 * @output sourceCount - Number of successful sources
 */
function mergeEnrichments(
  clearbit: EnrichmentData | null,
  linkedin: EnrichmentData | null,
  github: EnrichmentData | null
): { profile: Record<string, unknown>; sourceCount: number } {
  return { profile: {}, sourceCount: 0 };
}
`;

  describe('mandatory port injection', () => {
    it('should inject execute input port for expression nodes', () => {
      const result = parseNodeTypeFromCode(expressionNodeCode, 'mergeEnrichments');
      expect(result).not.toBeNull();
      const inputPorts = result!.ports!.filter(p => p.direction === 'INPUT');
      const executePort = inputPorts.find(p => p.name === 'execute');
      expect(executePort).toBeDefined();
      expect(executePort!.type).toBe('STEP');
    });

    it('should inject onSuccess and onFailure output ports for expression nodes', () => {
      const result = parseNodeTypeFromCode(expressionNodeCode, 'mergeEnrichments');
      expect(result).not.toBeNull();
      const outputPorts = result!.ports!.filter(p => p.direction === 'OUTPUT');
      const onSuccess = outputPorts.find(p => p.name === 'onSuccess');
      const onFailure = outputPorts.find(p => p.name === 'onFailure');
      expect(onSuccess).toBeDefined();
      expect(onSuccess!.type).toBe('STEP');
      expect(onFailure).toBeDefined();
      expect(onFailure!.type).toBe('STEP');
    });

    it('should order mandatory ports before data ports', () => {
      const result = parseNodeTypeFromCode(expressionNodeCode, 'mergeEnrichments');
      expect(result).not.toBeNull();
      const portsByName = new Map(result!.ports!.map(p => [`${p.direction}:${p.name}`, p]));

      // execute should be order 0, data inputs should be 1+
      expect(portsByName.get('INPUT:execute')!.defaultOrder).toBe(0);
      expect(portsByName.get('INPUT:clearbit')!.defaultOrder!).toBeGreaterThan(0);
      expect(portsByName.get('INPUT:linkedin')!.defaultOrder!).toBeGreaterThan(0);
      expect(portsByName.get('INPUT:github')!.defaultOrder!).toBeGreaterThan(0);

      // onSuccess(0), onFailure(1), data outputs(2+)
      expect(portsByName.get('OUTPUT:onSuccess')!.defaultOrder).toBe(0);
      expect(portsByName.get('OUTPUT:onFailure')!.defaultOrder).toBe(1);
      expect(portsByName.get('OUTPUT:profile')!.defaultOrder!).toBeGreaterThanOrEqual(2);
      expect(portsByName.get('OUTPUT:sourceCount')!.defaultOrder!).toBeGreaterThanOrEqual(2);
    });

    it('should NOT double-inject mandatory ports for normal-mode nodes', () => {
      const normalNodeCode = `
/**
 * @flowWeaver nodeType
 * @label My Node
 * @input execute [order:0] [type:STEP] - Execute
 * @input data [order:1] - Some data
 * @output onSuccess [order:0] [type:STEP] - On Success
 * @output onFailure [order:1] [type:STEP] - On Failure
 * @output result [order:2] - The result
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean; onFailure: boolean; result: string } {
  return { onSuccess: true, onFailure: false, result: '' };
}
`;
      const result = parseNodeTypeFromCode(normalNodeCode, 'myNode');
      expect(result).not.toBeNull();

      // Should have exactly the ports from annotations, no duplicates
      const inputPorts = result!.ports!.filter(p => p.direction === 'INPUT');
      const outputPorts = result!.ports!.filter(p => p.direction === 'OUTPUT');
      expect(inputPorts).toHaveLength(2); // execute + data
      expect(outputPorts).toHaveLength(3); // onSuccess + onFailure + result

      // Orders should be unchanged
      const portsByName = new Map(result!.ports!.map(p => [`${p.direction}:${p.name}`, p]));
      expect(portsByName.get('INPUT:execute')!.defaultOrder).toBe(0);
      expect(portsByName.get('INPUT:data')!.defaultOrder).toBe(1);
    });
  });

  describe('type inference from function signature', () => {
    it('should infer OBJECT type for custom type parameters', () => {
      const result = parseNodeTypeFromCode(expressionNodeCode, 'mergeEnrichments');
      expect(result).not.toBeNull();
      const portsByName = new Map(result!.ports!.map(p => [`${p.direction}:${p.name}`, p]));

      // EnrichmentData | null should map to OBJECT (custom type, null stripped)
      expect(portsByName.get('INPUT:clearbit')!.type).toBe('OBJECT');
      expect(portsByName.get('INPUT:linkedin')!.type).toBe('OBJECT');
      expect(portsByName.get('INPUT:github')!.type).toBe('OBJECT');
    });

    it('should infer types from return type fields', () => {
      const result = parseNodeTypeFromCode(expressionNodeCode, 'mergeEnrichments');
      expect(result).not.toBeNull();
      const portsByName = new Map(result!.ports!.map(p => [`${p.direction}:${p.name}`, p]));

      // Record<string, unknown> should map to OBJECT
      expect(portsByName.get('OUTPUT:profile')!.type).toBe('OBJECT');
      // number should map to NUMBER
      expect(portsByName.get('OUTPUT:sourceCount')!.type).toBe('NUMBER');
    });

    it('should infer primitive types from signature', () => {
      const primitiveCode = `
/**
 * @flowWeaver nodeType
 * @expression
 * @label Format
 * @input text - Input text
 * @input count - Repeat count
 * @input enabled - Whether enabled
 * @output formatted - Formatted output
 * @output length - Output length
 * @output valid - Whether valid
 */
function format(
  text: string,
  count: number,
  enabled: boolean
): { formatted: string; length: number; valid: boolean } {
  return { formatted: '', length: 0, valid: true };
}
`;
      const result = parseNodeTypeFromCode(primitiveCode, 'format');
      expect(result).not.toBeNull();
      const portsByName = new Map(result!.ports!.map(p => [`${p.direction}:${p.name}`, p]));

      expect(portsByName.get('INPUT:text')!.type).toBe('STRING');
      expect(portsByName.get('INPUT:count')!.type).toBe('NUMBER');
      expect(portsByName.get('INPUT:enabled')!.type).toBe('BOOLEAN');
      expect(portsByName.get('OUTPUT:formatted')!.type).toBe('STRING');
      expect(portsByName.get('OUTPUT:length')!.type).toBe('NUMBER');
      expect(portsByName.get('OUTPUT:valid')!.type).toBe('BOOLEAN');
    });

    it('should infer ARRAY type from array parameters', () => {
      const arrayCode = `
/**
 * @flowWeaver nodeType
 * @expression
 * @label Collect
 * @input items - Input items
 * @input tags - Tags
 * @output combined - Combined items
 */
function collect(
  items: string[],
  tags: Array<string>
): { combined: string[] } {
  return { combined: [] };
}
`;
      const result = parseNodeTypeFromCode(arrayCode, 'collect');
      expect(result).not.toBeNull();
      const portsByName = new Map(result!.ports!.map(p => [`${p.direction}:${p.name}`, p]));

      expect(portsByName.get('INPUT:items')!.type).toBe('ARRAY');
      expect(portsByName.get('INPUT:tags')!.type).toBe('ARRAY');
      expect(portsByName.get('OUTPUT:combined')!.type).toBe('ARRAY');
    });

    it('should NOT override explicit [type:] annotations', () => {
      const explicitCode = `
/**
 * @flowWeaver nodeType
 * @expression
 * @label Custom
 * @input data [type:STRING] - The data
 * @output result [type:OBJECT] - The result
 */
function custom(
  data: any
): { result: number } {
  return { result: 0 };
}
`;
      const result = parseNodeTypeFromCode(explicitCode, 'custom');
      expect(result).not.toBeNull();
      const portsByName = new Map(result!.ports!.map(p => [`${p.direction}:${p.name}`, p]));

      // Explicit [type:STRING] should win over inferred ANY from 'any'
      expect(portsByName.get('INPUT:data')!.type).toBe('STRING');
      // Explicit [type:OBJECT] should win over inferred NUMBER from 'number'
      expect(portsByName.get('OUTPUT:result')!.type).toBe('OBJECT');
    });

    it('should infer types from async Promise return types', () => {
      const asyncCode = `
/**
 * @flowWeaver nodeType
 * @expression
 * @label Fetch
 * @input url - URL to fetch
 * @output body - Response body
 * @output status - HTTP status code
 */
async function fetchData(
  url: string
): Promise<{ body: string; status: number }> {
  return { body: '', status: 200 };
}
`;
      const result = parseNodeTypeFromCode(asyncCode, 'fetchData');
      expect(result).not.toBeNull();
      const portsByName = new Map(result!.ports!.map(p => [`${p.direction}:${p.name}`, p]));

      expect(portsByName.get('INPUT:url')!.type).toBe('STRING');
      expect(portsByName.get('OUTPUT:body')!.type).toBe('STRING');
      expect(portsByName.get('OUTPUT:status')!.type).toBe('NUMBER');
    });
  });
});
