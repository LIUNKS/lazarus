// Host-side encoder of inputs (Requirement 7). It writes the same Tagged_Value text as the
// Trusted_Script codec, and it rejects what an input must not contain: functions, symbols, cycles,
// and objects that only exist on the host. The value never crosses the boundary itself, only this text.

const MAX_DEPTH = 256;

const TYPED_ARRAY_KINDS: ReadonlySet<string> = new Set([
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array',
  'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
]);

export type EncodeResult = { ok: true; text: string } | { ok: false; message: string };

class Unsupported extends Error {}

const tagOf = (value: object): string => Object.prototype.toString.call(value);

function isIndexKey(key: string, length: number): boolean {
  const index = Number(key) >>> 0;
  return String(index) === key && index < length;
}

function writeNumber(value: number): string {
  if (Number.isNaN(value)) return '{"$":"nan"}';
  if (value === Infinity) return '{"$":"inf"}';
  if (value === -Infinity) return '{"$":"-inf"}';
  if (Object.is(value, -0)) return '{"$":"-0"}';
  return JSON.stringify(value);
}

/**
 * Encodes one input. A shared reference that is not a cycle is written in full at every occurrence,
 * so each copy built in the Sandbox is independent.
 */
export function encodeInput(value: unknown, maxBytes: number): EncodeResult {
  const parts: string[] = [];
  let bytes = 0;
  const ancestors = new Set<object>();

  const emit = (chunk: string): void => {
    bytes += Buffer.byteLength(chunk, 'utf8');
    if (bytes > maxBytes) throw new Unsupported('an input is larger than the limit "maxValueBytes"');
    parts.push(chunk);
  };

  const reject = (kind: string, path: string): never => {
    throw new Unsupported(`${kind} at ${path}`);
  };

  const writeEntries = (target: object, keys: string[], path: string, depth: number): void => {
    keys.sort();
    keys.forEach((key, index) => {
      emit(`${index === 0 ? '[' : ',['}${JSON.stringify(key)},`);
      write((target as Record<string, unknown>)[key], `${path}[${JSON.stringify(key)}]`, depth);
      emit(']');
    });
  };

  const writeObject = (object: object, path: string, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Unsupported('an input is nested deeper than 256 levels');
    if (ancestors.has(object)) throw new Unsupported('cyclic input');

    // A symbol-keyed function or symbol cannot be represented. Other symbol keys are ignored.
    for (const symbol of Object.getOwnPropertySymbols(object)) {
      const item = (object as Record<symbol, unknown>)[symbol];
      if (typeof item === 'function' || typeof item === 'symbol') reject(`${typeof item} under a symbol key`, path);
    }

    ancestors.add(object);
    const next = depth + 1;
    const tag = tagOf(object);

    if (tag === '[object Date]') {
      emit(`{"$":"date","t":${writeNumber(Date.prototype.getTime.call(object))}}`);
    } else if (tag === '[object RegExp]') {
      const expression = object as RegExp;
      emit(`{"$":"re","s":${JSON.stringify(expression.source)},"f":${JSON.stringify(expression.flags)}}`);
    } else if (tag === '[object Map]') {
      emit('{"$":"map","e":[');
      let index = 0;
      Map.prototype.forEach.call(object, (item: unknown, key: unknown) => {
        emit(index === 0 ? '[' : ',[');
        write(key, `${path}.<key ${index}>`, next);
        emit(',');
        write(item, `${path}.<value ${index}>`, next);
        emit(']');
        index++;
      });
      emit(']}');
    } else if (tag === '[object Set]') {
      emit('{"$":"set","e":[');
      let index = 0;
      Set.prototype.forEach.call(object, (item: unknown) => {
        if (index > 0) emit(',');
        write(item, `${path}.<item ${index}>`, next);
        index++;
      });
      emit(']}');
    } else if (tag === '[object Error]') {
      const error = object as { name?: unknown; message?: unknown };
      emit('{"$":"err","n":');
      write(error.name, `${path}.name`, next);
      emit(',"m":');
      write(error.message, `${path}.message`, next);
      emit('}');
    } else if (ArrayBuffer.isView(object) && TYPED_ARRAY_KINDS.has(tag.slice(8, -1))) {
      const elements = object as unknown as ArrayLike<number | bigint>;
      emit(`{"$":"ta","c":"${tag.slice(8, -1)}","e":[`);
      for (let index = 0; index < elements.length; index++) {
        if (index > 0) emit(',');
        write(elements[index], `${path}[${index}]`, next);
      }
      emit(']}');
    } else if (Array.isArray(object)) {
      emit('{"$":"arr","v":[');
      for (let index = 0; index < object.length; index++) {
        if (index > 0) emit(',');
        if (Object.hasOwn(object, index)) write(object[index], `${path}[${index}]`, next);
        else emit('{"$":"hole"}');
      }
      emit(']');
      const extra = Object.keys(object).filter((key) => !isIndexKey(key, object.length));
      if (extra.length > 0) {
        emit(',"x":[');
        writeEntries(object, extra, path, next);
        emit(']');
      }
      emit('}');
    } else if (tag === '[object Object]') {
      emit('{"$":"obj","e":[');
      writeEntries(object, Object.keys(object), path, next);
      emit(']}');
    } else {
      // WeakMap, Promise, URL, ArrayBuffer, DataView, boxed primitives, and so on.
      reject(`unsupported object (${tag.slice(8, -1)})`, path);
    }

    ancestors.delete(object);
  };

  const write = (item: unknown, path: string, depth: number): void => {
    switch (typeof item) {
      case 'undefined':
        return emit('{"$":"u"}');
      case 'boolean':
        return emit(item ? 'true' : 'false');
      case 'number':
        return emit(writeNumber(item));
      case 'string':
        if (item.length > maxBytes) throw new Unsupported('an input is larger than the limit "maxValueBytes"');
        return emit(JSON.stringify(item));
      case 'bigint':
        return emit(`{"$":"big","v":"${item.toString()}"}`);
      case 'function':
      case 'symbol':
        return reject(typeof item, path);
      default:
        if (item === null) return emit('null');
        return writeObject(item as object, path, depth);
    }
  };

  try {
    write(value, 'input', 1);
    return { ok: true, text: parts.join('') };
  } catch (error) {
    if (error instanceof Unsupported) return { ok: false, message: error.message };
    // A getter or a proxy trap of the input threw. The input cannot be read, so it is not supported.
    return { ok: false, message: 'an input could not be read' };
  }
}
