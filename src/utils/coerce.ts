/**
 * Type coercion utilities for MCP tool parameters.
 *
 * MCP clients (e.g., Claude) send all tool parameters as strings, even when
 * the schema specifies number or boolean types. These utilities coerce string
 * values to the correct types before validation/use.
 */

/**
 * Coerce a value that should be a number. If the value is a string
 * representation of a number, parse it. Otherwise return as-is.
 */
export function coerceNumber<T>(value: T): T {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed as unknown as T;
    }
  }
  return value;
}

/**
 * Coerce a value that should be a boolean. If the value is a string
 * "true" or "false", convert it. Otherwise return as-is.
 */
export function coerceBoolean<T>(value: T): T {
  if (typeof value === 'string') {
    if (value === 'true') return true as unknown as T;
    if (value === 'false') return false as unknown as T;
  }
  return value;
}

/**
 * Schema for describing which fields need coercion.
 * Keys are dot-separated paths (e.g., "criteria.size" for nested objects).
 */
export type CoercionSpec = Record<string, 'number' | 'boolean'>;

/**
 * Coerce tool arguments based on a spec that maps field names to their
 * expected types. Mutates the args object in place for efficiency.
 *
 * Supports top-level fields only (no nested dot-path notation).
 * For nested objects, coerce them separately.
 *
 * @example
 * ```ts
 * coerceArgs(args, {
 *   maxResults: 'number',
 *   confirm: 'boolean',
 * });
 * ```
 */
export function coerceArgs<T extends Record<string, unknown>>(
  args: T,
  spec: CoercionSpec,
): T {
  for (const [key, type] of Object.entries(spec)) {
    if (key in args && args[key] !== undefined) {
      if (type === 'number') {
        (args as Record<string, unknown>)[key] = coerceNumber(args[key]);
      } else if (type === 'boolean') {
        (args as Record<string, unknown>)[key] = coerceBoolean(args[key]);
      }
    }
  }
  return args;
}
