/* eslint-disable */
// Trusted_Script fragment 1: prelude.
//
// The fragments (prelude, codec, side or driver) are concatenated inside ONE function body and
// evaluated in a fresh context before any untrusted code runs. Everything declared here is local to
// that function, so nothing is added to the global object. Every intrinsic the later fragments need
// is captured here, because untrusted code may replace or delete built-ins afterwards.
//
// Plain ES2022 text. No imports, no template processing.

// uncurry(fn)(thisArg, a, b) calls fn with that receiver, without reading fn.call at call time.
var uncurry = Function.prototype.bind.bind(Function.prototype.call);

var $Array = Array;
var $BigInt = BigInt;
var $Date = Date;
var $Error = Error;
var $Map = Map;
var $RegExp = RegExp;
var $Set = Set;

var ArrayIsArray = Array.isArray;
var ArrayBufferIsView = ArrayBuffer.isView;
var JSONParse = JSON.parse;
var JSONStringify = JSON.stringify;
var ObjectCreate = Object.create;
var ObjectIs = Object.is;
var ObjectKeys = Object.keys;
var ReflectDefineProperty = Reflect.defineProperty;
var ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;

var getterOf = function (target, key) {
  return uncurry(ReflectGetOwnPropertyDescriptor(target, key).get);
};

var tagOf = uncurry(Object.prototype.toString);
var hasOwn = uncurry(Object.prototype.hasOwnProperty);
var sortStrings = uncurry(Array.prototype.sort);
var bigIntToString = uncurry(BigInt.prototype.toString);
var dateGetTime = uncurry(Date.prototype.getTime);
var mapForEach = uncurry(Map.prototype.forEach);
var mapSet = uncurry(Map.prototype.set);
var setForEach = uncurry(Set.prototype.forEach);
var setAdd = uncurry(Set.prototype.add);
var regExpSource = getterOf(RegExp.prototype, 'source');
var regExpFlags = getterOf(RegExp.prototype, 'flags');
var stringCharCodeAt = uncurry(String.prototype.charCodeAt);
var stringSlice = uncurry(String.prototype.slice);
var stringIndexOf = uncurry(String.prototype.indexOf);
var typedArrayLength = getterOf(Object.getPrototypeOf(Int8Array.prototype), 'length');
var promiseThen = uncurry(Promise.prototype.then);

// Lookup tables without a prototype, so a key such as "constructor" finds nothing.
var TYPED_ARRAYS = ObjectCreate(null);
TYPED_ARRAYS.Int8Array = Int8Array;
TYPED_ARRAYS.Uint8Array = Uint8Array;
TYPED_ARRAYS.Uint8ClampedArray = Uint8ClampedArray;
TYPED_ARRAYS.Int16Array = Int16Array;
TYPED_ARRAYS.Uint16Array = Uint16Array;
TYPED_ARRAYS.Int32Array = Int32Array;
TYPED_ARRAYS.Uint32Array = Uint32Array;
TYPED_ARRAYS.Float32Array = Float32Array;
TYPED_ARRAYS.Float64Array = Float64Array;
TYPED_ARRAYS.BigInt64Array = BigInt64Array;
TYPED_ARRAYS.BigUint64Array = BigUint64Array;

var ERROR_TYPES = ObjectCreate(null);
ERROR_TYPES.Error = Error;
ERROR_TYPES.EvalError = EvalError;
ERROR_TYPES.RangeError = RangeError;
ERROR_TYPES.ReferenceError = ReferenceError;
ERROR_TYPES.SyntaxError = SyntaxError;
ERROR_TYPES.TypeError = TypeError;
ERROR_TYPES.URIError = URIError;

// A data descriptor without a prototype. An ordinary object literal would inherit from
// Object.prototype, where untrusted code could plant a `get` or `set` field.
var dataDescriptor = function (value, enumerable) {
  var descriptor = ObjectCreate(null);
  descriptor.value = value;
  descriptor.writable = true;
  descriptor.enumerable = enumerable;
  descriptor.configurable = true;
  return descriptor;
};

// Reads an own data property without calling a getter and without looking at the prototype chain.
var ownValue = function (target, key) {
  var descriptor = ReflectGetOwnPropertyDescriptor(target, key);
  return descriptor === undefined ? undefined : descriptor.value;
};

// Failures raised by the Trusted_Scripts themselves. The token is private to this closure, so
// untrusted code cannot build a value that passes isFailure.
var FAILURE_TOKEN = ObjectCreate(null);
var fail = function (code, message) {
  var failure = ObjectCreate(null);
  failure.token = FAILURE_TOKEN;
  failure.code = code;
  failure.message = message;
  throw failure;
};
var isFailure = function (value) {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return ownValue(value, 'token') === FAILURE_TOKEN;
  } catch (ignored) {
    return false;
  }
};

// Requirement 4, criterion 8, and Requirement 6, criterion 1. A fresh context also carries a
// `console` object (measured on Node.js 26), which is a Denied_Name, so it is removed as well.
delete globalThis.SharedArrayBuffer;
delete globalThis.Atomics;
delete globalThis.console;
ReflectDefineProperty(Error, 'prepareStackTrace', (function () {
  var descriptor = ObjectCreate(null);
  descriptor.value = undefined;
  descriptor.writable = false;
  descriptor.enumerable = false;
  descriptor.configurable = false;
  return descriptor;
})());

var truncate = function (text, max) {
  return text.length > max ? stringSlice(text, 0, max - 3) + '...' : text;
};

// Denied_Names of the glossary. A ReferenceError that names one of them is reported as a
// Forbidden_Capability. This is a best-effort report and never a security decision.
var DENIED_NAMES = ObjectCreate(null);
DENIED_NAMES.process = true;
DENIED_NAMES.require = true;
DENIED_NAMES.module = true;
DENIED_NAMES.global = true;
DENIED_NAMES.fetch = true;
DENIED_NAMES.XMLHttpRequest = true;
DENIED_NAMES.WebSocket = true;
DENIED_NAMES.Buffer = true;
DENIED_NAMES.console = true;
DENIED_NAMES.setTimeout = true;
DENIED_NAMES.setInterval = true;
DENIED_NAMES.setImmediate = true;
DENIED_NAMES.queueMicrotask = true;

// Reads `name` and `message` of a thrown value and nothing else (Requirement 6, criterion 4). Each is
// kept only when it is a string. A getter may run untrusted code; the caller is under a vm timeout.
var readThrown = function (thrown) {
  var record = ObjectCreate(null);
  record.name = null;
  record.message = null;
  if ((typeof thrown === 'object' && thrown !== null) || typeof thrown === 'function') {
    try {
      var name = thrown.name;
      if (typeof name === 'string') record.name = name;
      var message = thrown.message;
      if (typeof message === 'string') record.message = message;
    } catch (ignored) {}
  }
  return record;
};

// The name of the denied capability a thrown value points at, or '' when there is none.
var classifyForbidden = function (record) {
  if (record.name === 'EvalError' && CONFIG.allowDynamicCode !== true) return 'dynamic code generation';
  if (record.name === 'CompileError') return 'WebAssembly compilation';
  if (record.name === 'ReferenceError' && record.message !== null) {
    var end = stringIndexOf(record.message, ' is not defined');
    if (end > 0) {
      var identifier = stringSlice(record.message, 0, end);
      if (DENIED_NAMES[identifier] === true) return identifier;
    }
  }
  return '';
};

// "Name: message", at most 300 characters, for load errors and Test_Code errors (Requirement 6, criterion 5).
var describeThrown = function (record) {
  if (record.name === null) return 'a value that is not an error was thrown';
  return truncate(record.message === null || record.message === '' ? record.name : record.name + ': ' + record.message, 300);
};
