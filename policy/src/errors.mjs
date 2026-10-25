export class PolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PolicyError';
    this.code = code;
  }
}
export function requirePolicy(condition, code) {
  if (!condition) throw new PolicyError(code);
}
export function exactKeys(value, keys, code = 'INVALID_INPUT') {
  requirePolicy(value && Object.getPrototypeOf(value) === Object.prototype, code);
  requirePolicy(
    Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
    code,
  );
  requirePolicy(
    Object.values(Object.getOwnPropertyDescriptors(value)).every((d) => 'value' in d),
    code,
  );
}
export function uint(value, bits = 64) {
  requirePolicy(
    typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 40,
    'INVALID_INTEGER',
  );
  const number = BigInt(value);
  requirePolicy(number < 1n << BigInt(bits), 'INVALID_INTEGER');
  return number;
}
export function positiveAmount(value) {
  const number = uint(value, 127);
  requirePolicy(number > 0n, 'INVALID_AMOUNT');
  return number;
}
export function hex32(value) {
  requirePolicy(
    typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value),
    'INVALID_BYTES',
  );
  return value;
}
export function identifier(value) {
  requirePolicy(
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value),
    'INVALID_REFERENCE',
  );
  return value;
}
