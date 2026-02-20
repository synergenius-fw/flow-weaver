export type TStatusType =
  | "RUNNING"
  | "SCHEDULED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "PENDING"
  | "WAITING_FOR_AGENT";

export type TVariableIdentification = {
  nodeTypeName: string;
  id: string;
  scope?: string;
  side?: "start" | "exit";
  portName: string;
  executionIndex: number;
  key?: string;
};

export type TStatusChangedEvent = {
  type: "STATUS_CHANGED";
  nodeTypeName: string;
  id: string;
  scope?: string;
  side?: "start" | "exit";
  executionIndex: number;
  status: TStatusType;
  innerFlowInvocation?: boolean;
};

export type TVariableSetEvent = {
  type: "VARIABLE_SET";
  identifier: TVariableIdentification;
  value?: unknown;
  innerFlowInvocation?: boolean;
};

export type TErrorLogEvent = {
  type: "LOG_ERROR";
  nodeTypeName: string;
  id: string;
  scope?: string;
  side?: "start" | "exit";
  executionIndex: number;
  error: string;
  innerFlowInvocation?: boolean;
};

export type TWorkflowCompletedEvent = {
  type: "WORKFLOW_COMPLETED";
  executionIndex: number;
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  result?: unknown;
  innerFlowInvocation?: boolean;
};

export type TEvent =
  | TStatusChangedEvent
  | TVariableSetEvent
  | TErrorLogEvent
  | TWorkflowCompletedEvent;

export type TDebugger = {
  sendEvent: (event: TEvent) => void;
  innerFlowInvocation: boolean;
  sessionId?: string;
};
