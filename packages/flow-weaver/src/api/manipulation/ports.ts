/**
 * Port operations for workflow manipulation
 */

import { produce } from "immer";
import type { TWorkflowAST, TNodeInstanceAST } from "../../ast/types";
import { withoutValidation } from "../helpers";

/**
 * Swap the order of two ports on a node type
 *
 * @param ast - Workflow to modify
 * @param nodeTypeName - Name of the node type (or "Start"/"Exit" for workflow interface)
 * @param portName1 - Name of first port
 * @param portName2 - Name of second port
 * @returns Modified workflow
 * @throws {Error} If node type doesn't exist or ports are invalid
 *
 * @example
 * ```typescript
 * const ast = swapPortOrder(workflow, 'MyNode', 'input1', 'input2');
 * ```
 */
/**
 * Helper function to compute implicit port order based on position in the ports object
 */
function getImplicitOrder(ports: Record<string, unknown>, portName: string): number {
  const portNames = Object.keys(ports);
  return portNames.indexOf(portName);
}


/**
 * Swap the order of two ports on a node type (Start/Exit only)
 * For regular instances, use swapNodeInstancePortOrder()
 *
 * @param ast - Workflow to modify
 * @param nodeTypeName - Name of the node type ("Start" or "Exit" only)
 * @param portName1 - Name of first port
 * @param portName2 - Name of second port
 * @returns Modified workflow
 * @throws {Error} If used with non-Start/Exit nodes or ports are invalid
 */
export function swapPortOrder(
  ast: TWorkflowAST,
  nodeTypeName: string,
  portName1: string,
  portName2: string,
): TWorkflowAST {
  if (nodeTypeName !== "Start" && nodeTypeName !== "Exit") {
    throw new Error(
      `swapPortOrder() only supports Start/Exit nodes. ` +
      `Use swapNodeInstancePortOrder() for instance "${nodeTypeName}".`
    );
  }

  return withoutValidation(
    ast,
    (draft) => {
      // Handle Start/Exit nodes specially
      if (nodeTypeName === "Start") {
        if (!draft.startPorts) {
          throw new Error("Start ports not found");
        }
        const port1 = draft.startPorts[portName1];
        const port2 = draft.startPorts[portName2];

        if (!port1) throw new Error(`Port "${portName1}" not found on Start node`);
        if (!port2) throw new Error(`Port "${portName2}" not found on Start node`);

        // Use explicit order if present, otherwise compute from position
        const order1 = port1.metadata?.order ?? getImplicitOrder(draft.startPorts, portName1);
        const order2 = port2.metadata?.order ?? getImplicitOrder(draft.startPorts, portName2);

        // Swap orders for all ports (including system ports)
        port1.metadata = { ...port1.metadata, order: order2 };
        port2.metadata = { ...port2.metadata, order: order1 };
      } else if (nodeTypeName === "Exit") {
        if (!draft.exitPorts) {
          throw new Error("Exit ports not found");
        }
        const port1 = draft.exitPorts[portName1];
        const port2 = draft.exitPorts[portName2];

        if (!port1) throw new Error(`Port "${portName1}" not found on Exit node`);
        if (!port2) throw new Error(`Port "${portName2}" not found on Exit node`);

        // Use explicit order if present, otherwise compute from position
        const order1 = port1.metadata?.order ?? getImplicitOrder(draft.exitPorts, portName1);
        const order2 = port2.metadata?.order ?? getImplicitOrder(draft.exitPorts, portName2);

        // Swap orders for all ports (including system ports)
        port1.metadata = { ...port1.metadata, order: order2 };
        port2.metadata = { ...port2.metadata, order: order1 };
      }
    },
  );
}

/**
 * Swap the order of two ports on a specific node instance (instance-level only)
 *
 * @param ast - Workflow to modify
 * @param instanceId - ID of the node instance
 * @param portName1 - Name of first port
 * @param portName2 - Name of second port
 * @returns Modified workflow
 * @throws {Error} If instance doesn't exist or ports are invalid
 *
 * @example
 * ```typescript
 * const ast = swapNodeInstancePortOrder(workflow, 'doubler1', 'value', 'execute');
 * ```
 */
export function swapNodeInstancePortOrder(
  ast: TWorkflowAST,
  instanceId: string,
  portName1: string,
  portName2: string,
): TWorkflowAST {
  return withoutValidation(ast, (draft) => {
    const instance = draft.instances.find(inst => inst.id === instanceId);
    if (!instance) {
      throw new Error(`Instance "${instanceId}" not found`);
    }

    // Find node type by matching either name or functionName
    const nodeType = draft.nodeTypes.find(nt => nt.name === instance.nodeType || nt.functionName === instance.nodeType);
    if (!nodeType) {
      throw new Error(`Node type "${instance.nodeType}" not found`);
    }

    // Helper to get the EFFECTIVE visual order (what user sees in UI)
    // This calculates order by: explicit order first, then implicit position as tiebreaker
    const getEffectiveOrder = (portName: string): { order: number; direction: "INPUT" | "OUTPUT" } => {
      const isInput = portName in nodeType.inputs;
      const isOutput = portName in nodeType.outputs;

      if (!isInput && !isOutput) {
        throw new Error(`Port "${portName}" not found on node type "${instance.nodeType}"`);
      }

      const direction: "INPUT" | "OUTPUT" = isInput ? "INPUT" : "OUTPUT";
      const ports = isInput ? nodeType.inputs : nodeType.outputs;

      // Get all ports in this direction with their orders
      const portsWithOrders = Object.keys(ports).map((pName, implicitIndex) => {
        // Check instance config first
        const instanceConfig = instance.config?.portConfigs?.find(
          pc => pc.portName === pName && (pc.direction == null || pc.direction === direction)
        );
        if (instanceConfig?.order !== undefined) {
          return { name: pName, explicitOrder: instanceConfig.order, implicitOrder: implicitIndex };
        }

        // Check node type metadata
        const port = ports[pName];
        const metadataOrder = port?.metadata?.order;
        if (typeof metadataOrder === "number") {
          return { name: pName, explicitOrder: metadataOrder, implicitOrder: implicitIndex };
        }

        // No explicit order
        return { name: pName, explicitOrder: undefined, implicitOrder: implicitIndex };
      });

      // Sort by: explicit order first, then implicit order as tiebreaker
      const sorted = portsWithOrders.sort((a, b) => {
        const aExplicit = a.explicitOrder ?? Infinity;
        const bExplicit = b.explicitOrder ?? Infinity;

        if (aExplicit !== bExplicit) {
          return aExplicit - bExplicit;
        }

        // Same explicit order (or both undefined) - use implicit as tiebreaker
        return a.implicitOrder - b.implicitOrder;
      });

      // Find the visual position (index in sorted array)
      const visualPosition = sorted.findIndex(p => p.name === portName);

      return { order: visualPosition, direction };
    };

    const port1Info = getEffectiveOrder(portName1);
    const port2Info = getEffectiveOrder(portName2);

    // Initialize config if needed
    if (!instance.config) {
      instance.config = {};
    }
    if (!instance.config.portConfigs) {
      instance.config.portConfigs = [];
    }

    // Helper to update or add a port config
    const updatePortConfig = (portName: string, direction: "INPUT" | "OUTPUT", order: number) => {
      const existingIndex = instance.config!.portConfigs!.findIndex(
        pc => pc.portName === portName && (pc.direction == null || pc.direction === direction)
      );

      if (existingIndex >= 0) {
        // Update existing config
        instance.config!.portConfigs![existingIndex] = {
          ...instance.config!.portConfigs![existingIndex],
          order,
        };
      } else {
        // Add new config
        instance.config!.portConfigs!.push({ portName, direction, order });
      }
    };

    // Swap the orders
    updatePortConfig(portName1, port1Info.direction, port2Info.order);
    updatePortConfig(portName2, port2Info.direction, port1Info.order);
  });
}

/**
 * Set Start or Exit node ports directly.
 * Used by worker to persist port configuration changes on virtual nodes.
 *
 * @param ast - Workflow to modify
 * @param nodeType - "Start" or "Exit"
 * @param ports - The ports object to set
 * @returns Modified workflow
 * @throws {Error} If nodeType is not "Start" or "Exit"
 */
export function setStartExitPorts(
  ast: TWorkflowAST,
  nodeType: "Start" | "Exit",
  ports: Record<string, unknown>,
): TWorkflowAST {
  if (nodeType !== "Start" && nodeType !== "Exit") {
    throw new Error(`nodeType must be "Start" or "Exit", got "${nodeType}"`);
  }

  // Use produce directly with simplified type to avoid excessive type instantiation
  return produce(ast, (draft: { startPorts?: unknown; exitPorts?: unknown }) => {
    if (nodeType === "Start") {
      draft.startPorts = ports;
    } else {
      draft.exitPorts = ports;
    }
  }) as TWorkflowAST;
}

/**
 * Set instance port configs directly.
 * Used by worker to persist port configuration changes.
 *
 * @param ast - Workflow to modify
 * @param instanceId - ID of the node instance
 * @param portConfigs - The port configs array to set
 * @returns Modified workflow
 * @throws {Error} If instance doesn't exist
 */
export function setInstancePortConfigs(
  ast: TWorkflowAST,
  instanceId: string,
  portConfigs: Array<{ portName: string; direction: "INPUT" | "OUTPUT"; order?: number }>,
): TWorkflowAST {
  // Validate before mutation to avoid type instantiation issues inside callback
  const instance = ast.instances.find(inst => inst.id === instanceId);
  if (!instance) {
    throw new Error(`Instance "${instanceId}" not found`);
  }

  // Use produce directly with simplified type to avoid excessive type instantiation
  return produce(ast, (draft: { instances: TNodeInstanceAST[] }) => {
    const draftInstance = draft.instances.find(inst => inst.id === instanceId);
    if (!draftInstance) return; // Already validated above

    if (!draftInstance.config) {
      draftInstance.config = {};
    }
    draftInstance.config.portConfigs = portConfigs;
  }) as TWorkflowAST;
}
