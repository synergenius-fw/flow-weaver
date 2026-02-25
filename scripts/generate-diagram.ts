import { fileToHTML } from '../src/diagram/index.js';
import { writeFileSync } from 'fs';

const file = process.argv[2];
const out = process.argv[3] || '/tmp/diagram.html';

if (!file) {
  console.error('Usage: npm run diagram <input-file> [output-file]');
  process.exit(1);
}

const html = fileToHTML(file);
writeFileSync(out, html);
console.log(`Written to ${out}`);
