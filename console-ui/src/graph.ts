/**
 * The lane layout lives in the library (`src/diagram/lanes.ts`) so the SVG
 * the console hands out is the picture the console shows. This module only
 * names it for the client.
 */
export { buildLanes as buildGraph, edgePath } from '../../src/diagram/lanes';
export type { LaneRow as GRow, LaneEdge as GEdge, LaneGraph as Graph, EdgeKind } from '../../src/diagram/lanes';
