type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * @flowWeaver nodeType
 * @durableEffect
 * @input value - recursive JSON value
 * @output value - retained recursive JSON value
 * @output onSuccess - success branch
 * @output onFailure - failure branch
 */
export async function retainRecursiveJson(
  value: JsonValue,
  operationKey: string,
): Promise<{
  receipt: { operationKey: string };
  result: { value: JsonValue; onSuccess: boolean; onFailure: boolean };
}> {
  return {
    receipt: { operationKey },
    result: { value, onSuccess: true, onFailure: false },
  };
}

/**
 * @flowWeaver workflow
 * @start Start
 * @end Exit
 */
export async function recursiveJsonEffect(): Promise<void> {
  /** @type {JsonValue} */
  const value = { nested: [{ retained: true }] };
  const retained = await retainRecursiveJson(value, 'injected-by-compiler');
  void retained;
}
