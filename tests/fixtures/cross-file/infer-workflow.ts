import { add, fetchGreeting } from './infer-utils';

/**
 * @flowWeaver workflow
 * @node adder add
 * @node greeter fetchGreeting
 * @connect Start.execute -> adder.execute
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.onSuccess -> greeter.execute
 * @connect adder.sum -> Exit.sum
 * @connect Start.name -> greeter.name
 * @connect greeter.result -> Exit.greeting
 * @connect greeter.onSuccess -> Exit.onSuccess
 */
export function inferWorkflow(
  execute: boolean,
  a: number,
  b: number,
  name: string
): { sum: number; greeting: string; onSuccess: boolean } {
  throw new Error('Not implemented');
}
