/**
 * A JSON object given on the command line, inline (`--params '{...}'`) or in
 * a file (`--params-file p.json`). The inline form wins when both are given.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The object, or undefined when neither form was given.
 *
 * @param flag The inline flag's name without dashes, such as `params`; the
 *   file flag is the same name with `-file`.
 */
export function readJsonObjectOption(inline: string | undefined, file: string | undefined, flag: string): Record<string, unknown> | undefined {
  if (inline) {
    let value: unknown;
    try { value = JSON.parse(inline); } catch { throw new Error(`Invalid JSON in --${flag}: ${inline}`); }
    if (!isObject(value)) throw new Error(`--${flag} must be a JSON object, like {"name": "value"}`);
    return value;
  }
  if (!file) return undefined;
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`${flag[0].toUpperCase()}${flag.slice(1)} file not found: ${resolved}`);
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch { throw new Error(`Failed to parse ${flag} file: ${file}`); }
  if (!isObject(value)) throw new Error(`--${flag}-file must hold a JSON object, like {"name": "value"}`);
  return value;
}
