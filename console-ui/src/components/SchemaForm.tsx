import { useState } from 'preact/hooks';
import type { FieldSchema } from '../state';
import { Select } from './Select';
import { JsonEditor } from './JsonEditor';

export type Errors = Record<string, string>;

/** Validate a value against a schema. Keys are dotted paths, one message each. */
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
        <Select
          value={value === undefined ? '' : String(value)}
          placeholder="choose…"
          options={schema.values!.map((v) => ({ value: String(v), label: String(v) }))}
          onChange={(s) => { const v = schema.values!.find((x) => String(x) === s); onChange(v); }}
        />,
      );
    case 'array':
      if (isPrimitiveList(schema)) {
        const lines = Array.isArray(value) ? (value as unknown[]).map(String).join('\n') : '';
        return wrap(<textarea rows={3} value={lines} placeholder={schema.items!.type === 'number' ? '1\n2\n3 (one per line)' : 'one value per line'} onInput={(e) => {
          const raw = (e.target as HTMLTextAreaElement).value;
          const items = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (schema.items!.type === 'number' ? Number(l) : l));
          onChange(items.length ? items : undefined);
        }} />);
      }
      // A list of objects is rows to add and remove, each a form of its own.
      if (schema.items && (schema.items.type === 'object' && schema.items.fields || schema.items.type === 'boolean')) {
        return wrap(<ListField path={path} schema={schema} value={value} errors={errors} onChange={onChange} />);
      }
      return wrap(<JsonField value={value} onChange={onChange} placeholder={'[ … ] (a JSON list)'} />);
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
      // An open object (Record<string, unknown>): no fixed fields, but still
      // structured. Edit it as named properties, not a bare JSON blob.
      return wrap(<KeyValueField value={value} onChange={onChange} typeName={schema.text} />);
    default:
      return wrap(<JsonField value={value} onChange={onChange} />);
  }
}

/**
 * An open map edited as named property rows, with JSON as the escape hatch.
 *
 * A `Record<string, unknown>` has no fixed fields to lay out, but a raw JSON
 * textarea makes the caller write braces and quotes and get the commas right.
 * This shows one row per key — the name, then the value — so adding a property
 * is naming it and typing a value. Each value is read as JSON when it can be
 * (so `true`, `42`, `["a"]` keep their type) and as a plain string otherwise,
 * which is what someone typing a word expects.
 */
function KeyValueField({ value, onChange, typeName }: { value: unknown; onChange: (v: unknown) => void; typeName?: string }) {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const [raw, setRaw] = useState(false);
  // Row order is kept locally so a freshly added, still-empty key does not
  // vanish on the next keystroke (an empty key cannot live in the object yet).
  const [rows, setRows] = useState<Array<[string, unknown]>>(() => Object.entries(obj));
  const commit = (next: Array<[string, unknown]>) => {
    setRows(next);
    const clean = next.filter(([k]) => k.trim() !== '');
    onChange(clean.length ? Object.fromEntries(clean) : undefined);
  };
  const setKey = (i: number, k: string) => commit(rows.map((r, j) => (j === i ? [k, r[1]] : r)));
  const setVal = (i: number, v: unknown) => commit(rows.map((r, j) => (j === i ? [r[0], v] : r)));
  const add = () => setRows([...rows, ['', '']]);
  const remove = (i: number) => commit(rows.filter((_, j) => j !== i));

  const toggle = (
    <div class="kv-toolbar">
      <span class="hint">{typeName ?? 'object'}</span>
      <span class="sp" />
      <div class="seg sm">
        <button type="button" class={raw ? '' : 'on'} onClick={() => { setRows(Object.entries(obj)); setRaw(false); }}>Fields</button>
        <button type="button" class={raw ? 'on' : ''} onClick={() => setRaw(true)}>JSON</button>
      </div>
    </div>
  );

  if (raw) {
    return (
      <div class="kv-open">
        {toggle}
        <JsonField value={value} onChange={onChange} />
      </div>
    );
  }
  return (
    <div class="kv-open">
      {toggle}
      {rows.length > 0 && (
        <div class="kv-rows">
          {rows.map(([k, v], i) => (
            <div class="kv-row" key={i}>
              <input class="kv-key" type="text" value={k} placeholder="key" onInput={(e) => setKey(i, (e.target as HTMLInputElement).value)} />
              <KeyValueValue value={v} onChange={(nv) => setVal(i, nv)} />
              <button type="button" class="kv-del" title="Remove" onClick={() => remove(i)}>×</button>
            </div>
          ))}
        </div>
      )}
      <button type="button" class="add" onClick={add}>+ add property</button>
    </div>
  );
}

/** One value cell of an open map: JSON when it parses, a plain string otherwise. */
function KeyValueValue({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const asText = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return (
    <input
      class="kv-val mono"
      type="text"
      value={asText}
      placeholder="value"
      onInput={(e) => {
        const raw = (e.target as HTMLInputElement).value;
        if (raw === '') { onChange(''); return; }
        try { onChange(JSON.parse(raw)); } catch { onChange(raw); }
      }}
    />
  );
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

/** Free-form JSON, syntax-coloured, with live parse feedback; the value is committed only when it parses. */
function JsonField({ value, onChange, rows = 4, placeholder }: { value: unknown; onChange: (v: unknown) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  const tidy = () => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); setBad(false); } catch { setBad(true); } };
  return (
    <div class="jsonfield">
      <JsonEditor rows={rows} value={text} placeholder={placeholder ?? '{ "key": "value" } (any JSON)'} invalid={bad} onInput={(raw) => {
        setText(raw);
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
  /** A heading to sit on the same row as the Fields/JSON switch. */
  title?: string;
}

/** A form for a record of fields, with a switch to edit the whole thing as JSON and a way back to empty. */
/** Nothing typed anywhere, nested objects included. */
const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every(isEmpty));

export function SchemaForm({ fields, value, errors, onChange, plain, title }: SchemaFormProps) {
  const [raw, setRaw] = useState(false);
  const empty = isEmpty(value);
  return (
    <div>
      {!plain && (
        <div class={`formhead ${title ? 'titled' : ''}`}>
          {title && <h5>{title}</h5>}
          {!empty && <button type="button" class="formclear" onClick={() => onChange((blank({ type: 'object', fields }) as Record<string, unknown>) ?? {})}>clear</button>}
          <div class="seg sm">
            <button type="button" class={raw ? '' : 'on'} onClick={() => setRaw(false)}>Fields</button>
            <button type="button" class={raw ? 'on' : ''} onClick={() => setRaw(true)}>JSON</button>
          </div>
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
