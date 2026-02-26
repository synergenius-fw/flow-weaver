import { parser } from './src/parser';
import { annotationGenerator } from './src/annotation-generator';
import { WorkflowDiffer } from './src/diff/WorkflowDiffer';
import * as path from 'path';

const examplesDir = path.join(__dirname, './fixtures');
const filePath = path.join(examplesDir, 'basic/example-expression-mode.ts');
const result = parser.parse(filePath);

console.log('=== ORIGINAL WORKFLOW ===');
const workflow = result.workflows[0];
console.log(`Workflow: ${workflow.functionName}`);
console.log(`Original connections: ${workflow.connections.length}`);
workflow.connections.forEach((c, i) => {
  const fromScope = c.from.scope ? `:${c.from.scope}` : '';
  const toScope = c.to.scope ? `:${c.to.scope}` : '';
  console.log(`  ${i+1}. ${c.from.node}.${c.from.port}${fromScope} -> ${c.to.node}.${c.to.port}${toScope}`);
});

console.log('\n=== GENERATING ANNOTATIONS ===');
const regenerated = annotationGenerator.generate(workflow, {
  includeComments: true,
  includeMetadata: true,
});

console.log('\n=== REGENERATED CODE (CONNECT LINES) ===');
const lines = regenerated.split('\n');
const connectLines = lines.filter(l => l.includes('@connect'));
console.log('Generated @connect lines:');
connectLines.forEach(l => console.log(l));

console.log('\n=== RE-PARSING ===');
const reparsed = parser.parseFromString(regenerated);
const reworkflow = reparsed.workflows[0];
console.log(`Re-parsed connections: ${reworkflow.connections.length}`);
reworkflow.connections.forEach((c, i) => {
  const fromScope = c.from.scope ? `:${c.from.scope}` : '';
  const toScope = c.to.scope ? `:${c.to.scope}` : '';
  console.log(`  ${i+1}. ${c.from.node}.${c.from.port}${fromScope} -> ${c.to.node}.${c.to.port}${toScope}`);
});

console.log('\n=== DIFF ===');
const diff = WorkflowDiffer.compare(workflow, reworkflow);
console.log(`Connections removed: ${diff.summary.connectionsRemoved}`);
if (diff.connections.some(c => c.changeType === 'REMOVED')) {
  console.log('Removed connections:');
  diff.connections.filter(c => c.changeType === 'REMOVED').forEach(c => {
    const fromScope = c.from.scope ? `:${c.from.scope}` : '';
    const toScope = c.to.scope ? `:${c.to.scope}` : '';
    console.log(`  - ${c.from.node}.${c.from.port}${fromScope} -> ${c.to.node}.${c.to.port}${toScope}`);
  });
}
