export async function get<T = any>(path: string): Promise<T> {
  const r = await fetch(path);
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export async function post<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export async function put<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export async function del<T = any>(path: string): Promise<T> {
  const r = await fetch(path, { method: 'DELETE' });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export function stream(path: string, onMessage: (msg: any) => void): () => void {
  const es = new EventSource(path);
  es.onmessage = (m) => onMessage(JSON.parse(m.data));
  return () => es.close();
}

export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
