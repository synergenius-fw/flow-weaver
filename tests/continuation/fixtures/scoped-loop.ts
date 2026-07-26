/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:iteration
 * @output item scope:iteration
 * @output index scope:iteration
 * @input success scope:iteration
 * @input failure scope:iteration
 * @input result scope:iteration
 * @output results
 */
function forEach(
  execute: boolean,
  items: string[],
  iteration: (
    start: boolean,
    item: string,
    index: number,
  ) => { success: boolean; failure: boolean; result: string },
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map(
    (item, index) => iteration(true, item, index).result,
  );
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input item
 * @input index
 * @output formatted
 */
function format(execute: boolean, item: string, index: number) {
  if (!execute) return { onSuccess: false, onFailure: false, formatted: "" };
  return {
    onSuccess: true,
    onFailure: false,
    formatted: `${String(index)}:${item.toUpperCase()}`,
  };
}

/**
 * @flowWeaver workflow
 * @node loop forEach
 * @node formatter format loop.iteration
 * @connect Start.execute -> loop.execute
 * @connect Start.items -> loop.items
 * @connect loop.start:iteration -> formatter.execute
 * @connect loop.item:iteration -> formatter.item
 * @connect loop.index:iteration -> formatter.index
 * @connect formatter.formatted -> loop.result:iteration
 * @connect formatter.onSuccess -> loop.success:iteration
 * @connect formatter.onFailure -> loop.failure:iteration
 * @connect loop.results -> Exit.results
 */
export function scopedLoop(
  execute: boolean,
  params: { items: string[] },
): { onSuccess: boolean; onFailure: boolean; results: string[] } {
  throw new Error("Flow Weaver must generate this body");
}
