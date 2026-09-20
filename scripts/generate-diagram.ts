import { fileToSVG } from '../src/diagram/index.js';
import { writeFileSync } from 'fs';

const file = process.argv[2];
const out = process.argv[3] || '/tmp/diagram.svg';

if (!file) {
  console.error('Usage: npm run diagram <input-file> [output-file.svg]');
  process.exit(1);
}

writeFileSync(out, fileToSVG(file));
console.log(`Written to ${out}`);
