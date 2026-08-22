// A small JSON Schema validator — enough of draft 2020-12 to enforce
// contracts/record.schema.json and nothing more.
//
// Supported: type (incl. arrays of types), required, properties,
// additionalProperties, minLength, pattern, minimum/maximum, enum, items.
// Not supported: $ref, allOf/anyOf/oneOf, format (treated as advisory).
//
// The point is a zero-dependency oracle that can be run anywhere, including in a
// hackathon room with no npm registry. Swap in ajv in the real pipeline if you like;
// the schema file is the contract, not this file.

const typeOf = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;

function typeMatches(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected];
  const actual = typeOf(value);
  return types.some((t) => (t === 'number' ? actual === 'number' || actual === 'integer' : t === actual));
}

/** @returns {string[]} list of failures; empty means valid. */
export function validate(value, schema, path = '$') {
  const errors = [];

  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push(`${path}: expected ${[].concat(schema.type).join('|')}, got ${typeOf(value)}`);
    return errors; // further checks would be noise
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: required property missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validate(value[key], sub, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties ?? {}))) errors.push(`${path}.${key}: not allowed`);
      }
    }
  }
  return errors;
}

export const isValid = (value, schema) => validate(value, schema).length === 0;
