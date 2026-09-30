/** Catalog v0 — the closed vocabulary. See poc/PROTOCOL.md §6. */

export type PropType = 'number' | 'string' | 'boolean' | readonly string[];

/** What an element may hold: other nodes, text only, or nothing. */
export type ChildKind = 'nodes' | 'text' | 'none';

export interface ElementSpec {
  readonly props: Readonly<Record<string, PropType>>;
  readonly children: ChildKind;
  readonly events: readonly string[];
}

export const CATALOG: Readonly<Record<string, ElementSpec>> = {
  'mk-column': { props: { spacing: 'number', padding: 'number' }, children: 'nodes', events: [] },
  'mk-text': { props: { variant: ['body', 'title'] }, children: 'text', events: [] },
  'mk-button': { props: { disabled: 'boolean' }, children: 'text', events: ['tap'] },
  'mk-text-field': { props: { label: 'string', value: 'string' }, children: 'none', events: ['change'] },
};

/** Coerces a static attribute string to the catalog type. Throws when it does not fit. */
export function coerceAttribute(type: PropType, value: string, where: string): number | string | boolean {
  if (type === 'number') {
    const n = Number(value);
    if (value.trim() === '' || Number.isNaN(n)) throw new Error(`${where}: "${value}" is not a number`);
    return n;
  }
  if (type === 'boolean') {
    if (value === '' || value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${where}: "${value}" is not a boolean`);
  }
  return checkValue(type, value, where) as string;
}

/** Checks a bound property value against the catalog type. `null` always resets to the default. */
export function checkValue(type: PropType, value: unknown, where: string): number | string | boolean | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(type)) {
    if (typeof value === 'string' && type.includes(value)) return value;
    throw new Error(`${where}: expected one of ${type.join(', ')}, got ${JSON.stringify(value)}`);
  }
  if (typeof value !== type) throw new Error(`${where}: expected ${type}, got ${typeof value}`);
  if (type === 'number' && !Number.isFinite(value)) throw new Error(`${where}: number must be finite`);
  return value as number | string | boolean;
}
