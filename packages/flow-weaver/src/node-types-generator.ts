import type { TNodeTypeAST } from "./ast/types";
import {
  RESERVED_PORT_NAMES,
  isExecutePort,
  isSuccessPort,
  isFailurePort,
} from "./constants";

export interface TNodeTypePort {
  name: string;
  defaultLabel: string;
  reference: string;
  type: string;
  direction: "INPUT" | "OUTPUT";
  defaultOrder: number;
  defaultHidden?: boolean;
  failure?: boolean;
  defaultPlacement?: "TOP" | "BOTTOM" | "LEFT" | "RIGHT";
  scope?: string;
}

export interface TPortConfig {
  portName: string;
  direction: "INPUT" | "OUTPUT";
  order?: number;
  label?: string;
  expression?: string;
}

export interface TLocalFunctionNodeType {
  name: string;
  variant: "LOCAL_FUNCTION";
  synchronicity: "SYNC" | "ASYNC" | "BOTH" | "UNKNOWN";
  defaultLabel: string;
  description: string;
  category: string;
  scopes: string[];
  portConfigs: TPortConfig[];
  ports: TNodeTypePort[];
  defaultPullExecutionConfig?: {
    method: string;
  };
  path: string;
  projectPath: string;
  function: string;
  parameters: string[];
}

export class NodeTypesGenerator {
  generateNodeType(
    node: TNodeTypeAST,
    filePath: string,
    projectPath: string,
  ): TLocalFunctionNodeType {
    const ports: TNodeTypePort[] = [];
    let portOrder = 0;

    ports.push({
      name: RESERVED_PORT_NAMES.EXECUTE,
      defaultLabel: "Execute",
      reference: RESERVED_PORT_NAMES.EXECUTE,
      type: "STEP",
      direction: "INPUT",
      defaultOrder: portOrder++,
    });
    ports.push({
      name: RESERVED_PORT_NAMES.ON_SUCCESS,
      defaultLabel: "On Success",
      reference: RESERVED_PORT_NAMES.ON_SUCCESS,
      type: "STEP",
      direction: "OUTPUT",
      defaultOrder: portOrder++,
    });
    ports.push({
      name: RESERVED_PORT_NAMES.ON_FAILURE,
      defaultLabel: "On Failure",
      reference: RESERVED_PORT_NAMES.ON_FAILURE,
      type: "STEP",
      direction: "OUTPUT",
      failure: true,
      defaultPlacement: "BOTTOM",
      defaultOrder: portOrder++,
    });
    Object.entries(node.inputs).forEach(([portName, portConfig]) => {
      if (isExecutePort(portName)) return;
      ports.push({
        name: portName,
        defaultLabel: portConfig.label || this.formatLabel(portName),
        reference: portName,
        type: portConfig.dataType,
        direction: "INPUT",
        defaultOrder: portOrder++,
        defaultHidden: portConfig.hidden,
        ...(portConfig.scope && { scope: portConfig.scope }),
      });
    });
    Object.entries(node.outputs).forEach(([portName, portConfig]) => {
      if (isSuccessPort(portName) || isFailurePort(portName)) return;
      ports.push({
        name: portName,
        defaultLabel: portConfig.label || this.formatLabel(portName),
        reference: portName,
        type: portConfig.dataType,
        direction: "OUTPUT",
        defaultOrder: portOrder++,
        defaultHidden: portConfig.hidden,
        ...(portConfig.scope && { scope: portConfig.scope }),
      });
    });
    const functionText = node.functionText || '';
    const parameters = this.extractParameters(functionText);
    const synchronicity = this.determineSynchronicity(functionText);
    const label = node.label || this.formatLabel(node.functionName);
    const description =
      node.description ||
      this.extractDescription(functionText) ||
      `Node: ${label}`;
    const category = "Custom";
    return {
      name: node.functionName,
      variant: "LOCAL_FUNCTION",
      synchronicity,
      defaultLabel: label,
      description,
      category,
      scopes: node.scope ? [node.scope] : node.scopes || [],
      portConfigs: [],
      ports,
      defaultPullExecutionConfig: {
        method: RESERVED_PORT_NAMES.EXECUTE,
      },
      path: filePath,
      projectPath,
      function: node.functionName,
      parameters,
    };
  }
  generateAllNodeTypes(
    nodes: TNodeTypeAST[],
    filePath: string,
    projectPath: string,
  ): TLocalFunctionNodeType[] {
    return nodes.map((node) =>
      this.generateNodeType(node, filePath, projectPath),
    );
  }
  generateNodeTypesModule(
    nodes: TNodeTypeAST[],
    filePath: string,
    projectPath: string,
  ): string {
    const nodeTypes = this.generateAllNodeTypes(nodes, filePath, projectPath);
    const lines: string[] = [];
    lines.push("");
    lines.push("");
    lines.push("");
    lines.push(
      "import type { TLocalFunctionNodeType } from '@synergenius/flow-weaver';",
    );
    lines.push("");
    lines.push("export const nodeTypes: TLocalFunctionNodeType[] = [");
    nodeTypes.forEach((nodeType, idx) => {
      lines.push(
        `  ${JSON.stringify(nodeType, null, 2)}${idx < nodeTypes.length - 1 ? "," : ""}`,
      );
    });
    lines.push("];");
    lines.push("");
    nodeTypes.forEach((nodeType) => {
      lines.push(
        `export const ${nodeType.name}NodeType = nodeTypes.find(n => n.name === '${nodeType.name}')!;`,
      );
    });
    return lines.join("\n");
  }
  private formatLabel(name: string): string {
    return name
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }
  private extractDescription(functionText: string): string | null {
    const match = functionText.match(/\/\*\*\s*\n\s*\*\s*(.+?)\s*\n/);
    return match ? match[1] : null;
  }
  private extractParameters(functionText: string): string[] {
    const match = functionText.match(/function\s+\w+\s*\(([^)]*)\)/);
    if (!match || !match[1]) return [];
    return match[1]
      .split(",")
      .map((param) => param.trim().split(":")[0].trim())
      .filter((p) => p.length > 0);
  }
  private determineSynchronicity(
    functionText: string,
  ): "SYNC" | "ASYNC" | "BOTH" | "UNKNOWN" {
    if (functionText.includes("async function")) {
      return "ASYNC";
    }
    if (!functionText.includes("await") && !functionText.includes("Promise")) {
      return "SYNC";
    }
    return "BOTH";
  }
}

export const nodeTypesGenerator = new NodeTypesGenerator();
