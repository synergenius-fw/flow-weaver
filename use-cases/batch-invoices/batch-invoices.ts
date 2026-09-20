/**
 * Invoice batch: the shapes a straight line cannot show.
 *
 * Every other use case here is a chain, so nothing exercises the three
 * structures a reader actually struggles with: a scope that owns a two-step
 * body and runs it once per item, a node pulled on demand rather than on the trunk,
 * and a failure arm that rejoins further down. This workflow has all three
 * and no I/O, so it runs anywhere.
 */

export interface Invoice {
  id: string;
  customer: string;
  amountCents: number;
  currency: string;
}

export interface Rated {
  id: string;
  customer: string;
  amountCents: number;
  eur: number;
  flagged: boolean;
}

/**
 * Parse the batch and refuse it as a whole if any line is unusable. A batch
 * half-posted is worse than one rejected, so this is a gate in code: either
 * every line parses or none of them is charged.
 *
 * @flowWeaver nodeType
 * @label Read Batch
 * @color teal
 * @icon receipt
 * @input batch - Raw invoice lines
 * @output invoices - Parsed lines, safe to charge
 * @output rejection - Why the batch was refused
 */
export function readBatch(
  execute: boolean,
  batch: Record<string, unknown>[],
): { onSuccess: boolean; onFailure: boolean; invoices: Invoice[]; rejection: string } {
  if (!execute) return { onSuccess: false, onFailure: false, invoices: [], rejection: '' };
  const invoices: Invoice[] = [];
  for (const [i, line] of batch.entries()) {
    const amount = Number(line.amountCents);
    if (!line.id || !line.customer || !Number.isFinite(amount) || amount <= 0) {
      return { onSuccess: false, onFailure: true, invoices: [], rejection: `line ${i + 1} is not a chargeable invoice` };
    }
    invoices.push({
      id: String(line.id),
      customer: String(line.customer),
      amountCents: Math.round(amount),
      currency: String(line.currency ?? 'EUR'),
    });
  }
  if (invoices.length === 0) return { onSuccess: false, onFailure: true, invoices: [], rejection: 'the batch is empty' };
  return { onSuccess: true, onFailure: false, invoices, rejection: '' };
}

/**
 * Today's rates. Pulled rather than placed on the trunk: it takes no input
 * from the batch and is only worth fetching if a line actually needs
 * converting, which the rating step decides.
 *
 * @flowWeaver nodeType
 * @label FX Rates
 * @color yellow
 * @icon swapHoriz
 * @expression
 * @output rates - Rate per currency against EUR
 */
export function fxRates(): { rates: Record<string, number> } {
  return { rates: { EUR: 1, USD: 0.92, GBP: 1.17, CHF: 1.04 } };
}

/**
 * Rate one invoice: convert it to EUR.
 *
 * @flowWeaver nodeType
 * @label Rate Invoice
 * @color blue
 * @icon analytics
 * @expression
 * @input invoice - The invoice to rate
 * @input rates - Rate per currency
 * @output rated - The invoice with its EUR amount
 */
export function rateInvoice(invoice: Invoice, rates: Record<string, number>): { rated: Rated } {
  const rate = rates[invoice.currency];
  if (rate === undefined) throw new Error(`no rate for ${invoice.currency}`);
  const eur = Math.round(invoice.amountCents * rate) / 100;
  return { rated: { id: invoice.id, customer: invoice.customer, amountCents: invoice.amountCents, eur, flagged: false } };
}

/**
 * Flag anything a human should see. The second step of the per-line body:
 * two steps inside one scope is the shape a single-node body cannot show.
 *
 * @flowWeaver nodeType
 * @label Flag Large
 * @color orange
 * @icon flag
 * @expression
 * @input rated - The rated invoice
 * @output rated - The same invoice, flagged when it is large
 */
export function flagLarge(rated: Rated): { rated: Rated } {
  return { rated: { ...rated, flagged: rated.eur >= 1000 } };
}

/**
 * Run the rating once per invoice. The node owns the `line` scope and drives
 * it; the compiler hands it a callback for the body.
 *
 * @flowWeaver nodeType
 * @label For Each Invoice
 * @color purple
 * @icon repeat
 * @input invoices - Invoices to rate
 * @input rates - Rate per currency
 * @output start scope:line - Triggers the body
 * @output invoice scope:line - The invoice this pass is rating
 * @output rates scope:line - Rates, passed into the body
 * @input success scope:line - From the body's onSuccess
 * @input failure scope:line - From the body's onFailure
 * @input rated scope:line - What the body produced
 * @output results - Every rated invoice
 */
export function forEachInvoice(
  execute: boolean,
  invoices: Invoice[],
  rates: Record<string, number>,
  line: (start: boolean, invoice: Invoice, rates: Record<string, number>) => { success: boolean; failure: boolean; rated: Rated },
): { onSuccess: boolean; onFailure: boolean; results: Rated[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results: Rated[] = [];
  for (const invoice of invoices) {
    const pass = line(true, invoice, rates);
    if (!pass.success) return { onSuccess: false, onFailure: true, results };
    results.push(pass.rated);
  }
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Totals and the short list a person has to look at.
 *
 * @flowWeaver nodeType
 * @label Summarize
 * @color green
 * @icon summarize
 * @expression
 * @input results - Every rated invoice
 * @output summary - Totals and the flagged lines
 */
export function summarize(results: Rated[]): { summary: { count: number; totalEur: number; flagged: string[] } } {
  const totalEur = Math.round(results.reduce((sum, r) => sum + r.eur, 0) * 100) / 100;
  return { summary: { count: results.length, totalEur, flagged: results.filter((r) => r.flagged).map((r) => r.id) } };
}

/**
 * The one report both endings converge on, so a refusal and a posted batch
 * leave the same shape behind.
 *
 * @flowWeaver nodeType
 * @label Report
 * @color green
 * @icon checkCircle
 * @expression
 * @input [summary] - Totals, when the batch was rated
 * @input [rejection] - Why the batch was refused, when it was
 * @output status - "posted" or "refused"
 * @output report - What happened, in one line
 */
export function report(
  summary: { count: number; totalEur: number; flagged: string[] },
  rejection: string,
): { status: string; report: string } {
  // Both inputs are optional in the graph, not in the type: on the refusal
  // arm `summary` never arrived, and on the posted arm `rejection` did not.
  if (rejection) return { status: 'refused', report: `batch refused: ${rejection}` };
  if (!summary) return { status: 'refused', report: 'batch refused: nothing was rated' };
  const flagged = summary.flagged.length ? ` · ${summary.flagged.length} flagged (${summary.flagged.join(', ')})` : '';
  return { status: 'posted', report: `${summary.count} invoices · €${summary.totalEur}${flagged}` };
}

/**
 * Rate a batch of invoices and report on it.
 *
 * @flowWeaver workflow
 * @param batch - Raw invoice lines
 * @returns status - "posted" or "refused"
 * @returns report - What happened
 * @node read readBatch
 * @node rates fxRates [pullExecution: execute]
 * @node loop forEachInvoice
 * @node rate rateInvoice loop.line
 * @node flag flagLarge loop.line
 * @node sum summarize
 * @node finish report
 * @path Start -> read -> loop -> sum -> finish -> Exit
 * @connect read.onFailure -> finish.execute
 * @connect read.rejection -> finish.rejection
 * @connect read.invoices -> loop.invoices
 * @connect rates.rates -> loop.rates
 * @connect loop.start:line -> rate.execute
 * @connect loop.invoice:line -> rate.invoice
 * @connect loop.rates:line -> rate.rates
 * @connect rate.rated -> flag.rated
 * @connect rate.onSuccess -> flag.execute
 * @connect rate.onFailure -> loop.failure:line
 * @connect flag.rated -> loop.rated:line
 * @connect flag.onSuccess -> loop.success:line
 * @connect flag.onFailure -> loop.failure:line
 * @connect loop.onFailure -> finish.execute
 * @connect sum.summary -> finish.summary
 * @connect finish.status -> Exit.status
 * @connect finish.report -> Exit.report
 */
export function rateInvoiceBatch(
  execute: boolean,
  params: { batch: Record<string, unknown>[] },
): { onSuccess: boolean; onFailure: boolean; status: string; report: string } {
  throw new Error('generated body was not installed');
}
