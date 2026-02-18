import type { TDataType } from '../ast/types';

// ---- Public options ----

export interface DiagramOptions {
  theme?: 'dark' | 'light';
  width?: number;
  padding?: number;
  showPortLabels?: boolean;
  workflowName?: string;
}

// ---- Internal layout types ----

export interface DiagramPort {
  name: string;
  label: string;
  dataType: TDataType;
  direction: 'INPUT' | 'OUTPUT';
  isControlFlow: boolean;
  isFailure: boolean;
  cx: number;
  cy: number;
}

export interface DiagramNode {
  id: string;
  label: string;
  color: string;
  icon: string;
  isVirtual: boolean;
  inputs: DiagramPort[];
  outputs: DiagramPort[];
  x: number;
  y: number;
  width: number;
  height: number;
  // Scope rendering — present when node has scoped children
  scopeChildren?: DiagramNode[];
  scopeConnections?: DiagramConnection[];
  scopePorts?: { inputs: DiagramPort[]; outputs: DiagramPort[] };
}

export interface DiagramConnection {
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
  sourceColor: string;
  targetColor: string;
  isStepConnection: boolean;
  path: string;
}

export interface DiagramGraph {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  bounds: { width: number; height: number };
  workflowName: string;
}

// ---- Theme ----

export interface ThemePalette {
  background: string;
  nodeFill: string;
  nodeStroke: string;
  labelColor: string;
  sublabelColor: string;
  connectionColor: string;
  dotColor: string;
  labelBadgeFill: string;
  labelBadgeBorder: string;
  nodeIconColor: string;
  scopeAreaStroke: string;
}
