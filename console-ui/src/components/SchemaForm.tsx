import { useState } from 'preact/hooks';
import type { FieldSchema } from '../state';

export type Errors = Record<string, string>;

/** Validate a value against a schema; keys are dotted paths, one message each. */
export function validate(schema: FieldSchema, value: unknown, path = ''): Errors {
  const errs: Errors = {};
  const missing = value === undefined || value === null || value === '';
  if (missing) { if (!schema.optional) errs[path || '.'] = 'required'; return errs; }
  switch (schema.type) {
    case 'string': if (typeof value !== 'string') errs[path] = 'must be text'; break;
    case 'number': if (typeof value !== 'number' || Number.isNaN(value)) errs[path] = 'must be a number'; break;
    case 'boolean': if (typeof value !== 'boolean') errs[path] = 'must be yes or no'; break;
    case 'enum': if (!schema.values!.includes(value as string | number)) errs[path] = `one of ${schema.values!.join(', ')}`; break;
    case 'array':
      if (!Array.isArray(value)) { errs[path] = 'must be a list'; break; }
      value.forEach((v, i) => Object.assign(errs, validate(schema.items!, v, `${path}[${i}]`)));
      break;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) { errs[path] = 'must be an object'; break; }
      if (schema.fields) for (const [k, f] of Object.entries(schema.fields)) Object.assign(errs, validate(f, (value as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
      break;
  }
  return errs;
}

/** A starting value shaped like the schema, so nested forms have something to edit. */
export function blank(schema: FieldSchema): unknown {
  if (schema.type === 'object' && schema.fields) return Object.fromEntries(Object.entries(schema.fields).map(([k, f]) => [k, blank(f)]));
  return undefined;
}

const isPrimitiveList = (s: FieldSchema) => s.type === 'array' && s.items && ['string', 'number', 'enum'].includes(s.items.type);

/** What to say beside a field's name about its shape. */
function shapeHint(schema: FieldSchema): string {
  if (schema.type === 'array') return isPrimitiveList(schema) ? 'one per line' : schema.text ?? 'list';
  if (schema.type === 'object' && !schema.fields) return schema.text ?? 'object';
  if (schema.type === 'any') return schema.text ?? '';
  return '';
}

interface FieldProps { name: string; path: string; schema: FieldSchema; value: unknown; errors: Errors; onChange: (v: unknown) => void; /** No label: the field is an item in a list. */ bare?: boolean }

function Field({ name, path, schema, value, errors, onChange, bare }: FieldProps) {
  const err = errors[path] ?? errors[path || '.'];
  const label = bare ? null : (
    <>
      <label>
        <span>{name}{schema.optional ? <i> optional</i> : ''}</span>
        <i>{shapeHint(schema)}</i>
      </label>
      {schema.help && <div class="fhelp">{schema.help}</div>}
    </>
  );
  const wrap = (el: preact.JSX.Element) => (
    <div class={`field ${err ? 'bad' : ''}`}>{label}{el}{err && <div class="ferr">{err}</div>}</div>
  );

  switch (schema.type) {
    case 'string': {
      // Long text gets room; a line stays a line.
      const s = (value as string) ?? '';
      const placeholder = schema.text && schema.text !== 'string' ? schema.text : 'text';
      return wrap(s.length > 80 || s.includes('\n')
        ? <textarea rows={Math.min(8, s.split('\n').length + 1)} value={s} placeholder={placeholder} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value || undefined)} />
        : <input type="text" value={s} placeholder={placeholder} onInput={(e) => onChange((e.target as HTMLInputElement).value || undefined)} />);
    }
    case 'number':
      return wrap(<input type="number" step="any" value={value === undefined ? '' : String(value)} placeholder="a number" onInput={(e) => { const s = (e.target as HTMLInputElement).value; onChange(s === '' ? undefined : Number(s)); }} />);
    case 'boolean':
      return wrap(
        <div class="toggle">
          <button type="button" class={value === true ? 'on' : ''} onClick={() => onChange(true)}>yes</button>
          <button type="button" class={value === false ? 'on' : ''} onClick={() => onChange(false)}>no</button>
          {schema.optional && <button type="button" class={value === undefined ? 'on' : ''} onClick={() => onChange(undefined)}>unset</button>}
        </div>,
      );
    case 'enum':
      return wrap(
        <select value={value === undefined ? '' : String(value)} onChange={(e) => { const s = (e.target as HTMLSelectElement).value; const v = schema.values!.find((x) => String(x) === s); onChange(v); }}>
          <option value="">choose…</option>
          {schema.values!.map((v) => <option value={String(v)} key={String(v)}>{String(v)}</option>)}
        </select>,
      );
    case 'array':
      if (isPrimitiveList(schema)) {
        const lines = Array.isArray(value) ? (value as unknown[]).map(String).join('\n') : '';
        return wrap(<textarea rows={3} value={lines} placeholder={schema.items!.type === 'number' ? '1\n2\n3 — one per line' : 'one value per line'} onInput={(e) => {
          const raw = (e.target as HTMLTextAreaElement).value;
          const items = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (schema.items!.type === 'number' ? Number(l) : l));
          onChange(items.length ? items : undefined);
        }} />);
      }
      // A list of objects is rows to add and remove, each a form of its own.
      if (schema.items && (schema.items.type === 'object' && schema.items.fields || schema.items.type === 'boolean')) {
        return wrap(<ListField path={path} schema={schema} value={value} errors={errors} onChange={onChange} />);
      }
      return wrap(<JsonField value={value} onChange={onChange} placeholder={'[ … ] — a JSON list'} />);
    case 'object':
      if (schema.fields) {
        const obj = (value as Record<string, unknown>) ?? {};
        return (
          <div class="field">
            {label}
            <div class="fieldset">
              {Object.entries(schema.fields).map(([k, f]) => (
                <Field key={k} name={k} path={path ? `${path}.${k}` : k} schema={f} value={obj[k]} errors={errors} onChange={(v) => onChange({ ...obj, [k]: v })} />
              ))}
            </div>
          </div>
        );
      }
      return wrap(<JsonField value={value} onChange={onChange} />);
    default:
      return wrap(<JsonField value={value} onChange={onChange} />);
  }
}

/** Rows of a list, each edited as its own form, with add and remove. */
function ListField({ path, schema, value, errors, onChange }: { path: string; schema: FieldSchema; value: unknown; errors: Errors; onChange: (v: unknown) => void }) {
  const items = Array.isArray(value) ? (value as unknown[]) : [];
  const item = schema.items!;
  const set = (next: unknown[]) => onChange(next.length ? next : undefined);
  return (
    <div class="list">
      {items.map((it, i) => (
        <div class="item" key={i}>
          <div class="itemhead"><span>{i + 1}</span><button type="button" title="Remove" onClick={() => set(items.filter((_, j) => j !== i))}>×</button></div>
          <Field name="" path={`${path}[${i}]`} schema={item} value={it} errors={errors} onChange={(v) => set(items.map((x, j) => (j === i ? v : x)))} bare />
        </div>
      ))}
      <button type="button" class="add" onClick={() => set([...items, blank(item)])}>+ add {item.text && item.text.length < 30 ? item.text : 'one'}</button>
    </div>
  );
}

/** Free-form JSON with live parse feedback; the value is committed only when it parses. */
function JsonField({ value, onChange, rows = 4, placeholder }: { value: unknown; onChange: (v: unknown) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  const tidy = () => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); setBad(false); } catch { setBad(true); } };
  return (
    <div class="jsonfield">
      <textarea rows={rows} value={text} placeholder={placeholder ?? '{ "key": "value" } — any JSON'} style={bad ? 'border-color:var(--err)' : ''} onInput={(e) => {
        const raw = (e.target as HTMLTextAreaElement).value; setText(raw);
        if (!raw.trim()) { setBad(false); onChange(undefined); return; }
        try { onChange(JSON.parse(raw)); setBad(false); } catch { setBad(true); }
      }} />
      <div class="jsontools">{bad ? <span class="ferr">not valid JSON</span> : <span />}{text.trim() && <button type="button" onClick={tidy}>tidy</button>}</div>
    </div>
  );
}

export interface SchemaFormProps {
  fields: Record<string, FieldSchema>;
  value: Record<string, unknown>;
  errors: Errors;
  onChange: (v: Record<string, unknown>) => void;
  /** No form/JSON switch, no reset: for a small embedded form. */
  plain?: boolean;
}

/** A form for a record of fields, with a switch to edit the whole thing as JSON and a way back to empty. */
/** Nothing typed anywhere, nested objects included. */
const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every(isEmpty));

export function SchemaForm({ fields, value, errors, onChange, plain }: SchemaFormProps) {
  const [raw, setRaw] = useState(false);
  const empty = isEmpty(value);
  return (
    <div>
      {!plain && (
        <div class="formhead">
          {!empty && <button type="button" onClick={() => onChange((blank({ type: 'object', fields }) as Record<string, unknown>) ?? {})}>clear</button>}
          <button type="button" onClick={() => setRaw(!raw)}>{raw ? 'form' : 'JSON'}</button>
        </div>
      )}
      {raw
        ? <div class="field"><JsonField rows={8} value={value} onChange={(v) => onChange((v as Record<string, unknown>) ?? {})} /></div>
        : Object.entries(fields).map(([k, f]) => (
          <Field key={k} name={k} path={k} schema={f} value={value[k]} errors={errors} onChange={(v) => onChange({ ...value, [k]: v })} />
        ))}
    </div>
  );
}

export function validateFields(fields: Record<string, FieldSchema>, value: Record<string, unknown>): Errors {
  return validate({ type: 'object', fields }, value);
}
