export interface StrictJsonLimits {
  readonly maxDepth: number;
  readonly maxStringBytes: number;
  readonly maxObjectKeys: number;
  readonly maxArrayItems: number;
  readonly maxAggregateEntries: number;
}

const encoder = new TextEncoder();

export function parseStrictJson(
  text: string,
  limits: StrictJsonLimits,
): unknown {
  let index = 0;
  let aggregateEntries = 0;

  const fail = (code: StrictJsonErrorCode, message: string): never => {
    throw new StrictJsonError(code, message);
  };

  const skipWhitespace = (): void => {
    while (
      text[index] === " " ||
      text[index] === "\n" ||
      text[index] === "\r" ||
      text[index] === "\t"
    ) {
      index += 1;
    }
  };

  const parseString = (): string => {
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        let value: unknown;
        try {
          value = JSON.parse(text.slice(start, index));
        } catch {
          return fail("malformed", "JSON string is malformed");
        }
        if (
          typeof value !== "string" ||
          encoder.encode(value).byteLength > limits.maxStringBytes
        ) {
          return fail("oversized", "JSON string byte limit exceeded");
        }
        return value;
      }
      if (character === "\\") {
        index += 1;
        if (index >= text.length) {
          return fail("malformed", "JSON string escape is incomplete");
        }
        if (text[index] === "u") {
          for (let offset = 1; offset <= 4; offset += 1) {
            if (!/[0-9a-fA-F]/.test(text[index + offset] ?? "")) {
              return fail("malformed", "JSON unicode escape is malformed");
            }
          }
          index += 4;
        } else if (!/["\\/bfnrt]/.test(text[index]!)) {
          return fail("malformed", "JSON string escape is malformed");
        }
      } else if ((character?.charCodeAt(0) ?? 0) < 0x20) {
        return fail("malformed", "JSON string contains a control character");
      }
      index += 1;
    }
    return fail("malformed", "JSON string is unterminated");
  };

  const parseValue = (depth: number): unknown => {
    if (depth > limits.maxDepth) {
      return fail("oversized", "JSON depth limit exceeded");
    }
    skipWhitespace();
    const character = text[index];
    if (character === '"') return parseString();
    if (text.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (text.startsWith("false", index)) {
      index += 5;
      return false;
    }
    if (text.startsWith("null", index)) {
      index += 4;
      return null;
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      const values: unknown[] = [];
      if (text[index] === "]") {
        index += 1;
        return values;
      }
      while (true) {
        if (values.length >= limits.maxArrayItems) {
          return fail("oversized", "JSON array item limit exceeded");
        }
        aggregateEntries += 1;
        if (aggregateEntries > limits.maxAggregateEntries) {
          return fail("oversized", "JSON aggregate entry limit exceeded");
        }
        values.push(parseValue(depth + 1));
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return values;
        }
        if (text[index] !== ",") {
          return fail("malformed", "JSON array separator is malformed");
        }
        index += 1;
      }
    }
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const value: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      const keys = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return value;
      }
      while (true) {
        if (keys.size >= limits.maxObjectKeys) {
          return fail("oversized", "JSON object key limit exceeded");
        }
        skipWhitespace();
        if (text[index] !== '"') {
          return fail("malformed", "JSON object key must be a string");
        }
        const key = parseString();
        if (keys.has(key)) {
          return fail("malformed", `duplicate JSON object member ${key}`);
        }
        keys.add(key);
        aggregateEntries += 1;
        if (aggregateEntries > limits.maxAggregateEntries) {
          return fail("oversized", "JSON aggregate entry limit exceeded");
        }
        skipWhitespace();
        if (text[index] !== ":") {
          return fail("malformed", "JSON object member is missing a colon");
        }
        index += 1;
        value[key] = parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return value;
        }
        if (text[index] !== ",") {
          return fail("malformed", "JSON object separator is malformed");
        }
        index += 1;
      }
    }
    const number = text
      .slice(index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
    if (number !== undefined) {
      index += number.length;
      const value = Number(number);
      if (!Number.isFinite(value)) {
        return fail("malformed", "JSON number must be finite");
      }
      return value;
    }
    return fail("malformed", "JSON value is malformed");
  };

  const value = parseValue(0);
  skipWhitespace();
  if (index !== text.length) {
    fail("malformed", "JSON has trailing data");
  }
  return value;
}

export type StrictJsonErrorCode = "malformed" | "oversized";

export class StrictJsonError extends Error {
  readonly name = "StrictJsonError";

  constructor(
    readonly code: StrictJsonErrorCode,
    message: string,
  ) {
    super(message);
  }
}
