import { useEffect, useRef, useState } from 'preact/hooks';
import { askAgent, run, type AgentLog, type AgentNote } from '../state';
import { ms } from '../format';
import { Value } from './Value';

/**
 * What an agent profile is doing about a gate, on the step's row.
 *
 * While it works, the model's words stream in here and the tools it calls
 * are listed as they happen, so a person watching sees the same thing an
 * operator would in a terminal. When it is done the row keeps one line --
 * who answered, how long it took, what it cost in tokens -- and the
 * transcript folds away behind it. When it failed, the reason is here and
 * the gate's own form follows, so the person can finish the job.
 */
export function AgentPanel({ note, log, compact = false }: { note: AgentNote; log: AgentLog; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const answering = note.status === 'answering';
  const live = log.phase === 'answering' && (log.text || log.tools.length > 0 || log.thinking);
  // Follow the text as it comes, unless the person scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !answering) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
  }, [log.text, log.tools.length, answering]);

  const usage = note.usage ?? log.usage;
  const tokens = usage && usage.promptTokens + usage.completionTokens > 0 ? `${fmtK(usage.promptTokens + usage.completionTokens)} tokens` : '';
  const cost = usage?.costUsd ? ` · $${usage.costUsd.toFixed(4)}` : '';
  const took = note.endedAt && note.startedAt ? ms(Date.parse(note.endedAt) - Date.parse(note.startedAt)) : log.ms != null ? ms(log.ms) : '';
  const what = answering ? 'answering…'
    : note.status === 'answered' ? `answered${took ? ` in ${took}` : ''}`
      : note.status === 'rejected' ? `rejected${note.error ? `: ${note.error}` : ''}`
        : `could not answer${note.error ? `: ${note.error}` : ''}`;
  const model = note.model ? ` · ${note.model}` : '';
  const showLog = !compact && (answering || open) && (log.text || log.tools.length > 0 || log.thinking);
  const canRetry = !answering && run.value?.status === 'waiting';
  const retry = async () => { setBusy(true); try { await askAgent(); } finally { setBusy(false); } };

  return (
    <div class={`agentpanel ${note.status} ${compact ? 'compact' : ''}`}>
      <div class="ah" onClick={() => setOpen(!open)}>
        <span class="ms">smart_toy</span>
        <b>{note.profile}</b>
        <span class="hint">{note.provider}{model}</span>
        <span class={`what ${note.status}`}>{what}</span>
        <span class="sp" />
        {tokens && <span class="hint mono">{tokens}{cost}</span>}
        {!compact && (log.text || log.tools.length > 0) && !answering && <span class="ms fold">{open ? 'expand_less' : 'expand_more'}</span>}
      </div>
      {showLog && (
        <div class="alog" ref={scroller}>
          {log.thinking && <div class="athink">{log.thinking}</div>}
          {log.text && <div class="atext">{log.text}{answering && <span class="caret">▍</span>}</div>}
          {log.tools.length > 0 && (
            <div class="atools">
              {log.tools.map((t, i) => (
                <div class={`atool ${t.done ? (t.isError ? 'bad' : 'ok') : 'pending'}`} key={i}>
                  <span class="ms">{t.done ? (t.isError ? 'error' : 'check') : 'progress_activity'}</span>
                  <code>{t.name}</code>
                  {t.args !== undefined && <span class="aargs"><Value value={t.args} /></span>}
                  {t.done && t.result && <span class="ares hint">{t.result.length > 160 ? `${t.result.slice(0, 160)}…` : t.result}</span>}
                </div>
              ))}
            </div>
          )}
          {answering && !live && <div class="hint">waiting for the model…</div>}
        </div>
      )}
      {!compact && note.status === 'failed' && canRetry && (
        <div class="aactions">
          <span class="hint">Answer it below, or</span>
          <button class="btn sm" disabled={busy} onClick={retry}>{busy ? 'Asking…' : 'ask the agent again'}</button>
        </div>
      )}
    </div>
  );
}

function fmtK(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
