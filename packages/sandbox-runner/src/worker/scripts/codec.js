/* eslint-disable */
// Trusted_Script fragment 2: the value codec (Requirement 7).
//
// encode(value, maxBytes) writes the Tagged_Value text of a value. The text of an outcome is its
// Canonical_Form: two returned values are equivalent exactly when their texts are equal strings.
// decode(text) builds a fresh value with the constructors of the context this script runs in.
//
// It uses only the names captured by prelude.js.

var MAX_DEPTH = 256;

var utf8Length = function (text) {
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = stringCharCodeAt(text, i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
};

// True when `key` is an array index below `length` ("0", "1", ... without leading zeros).
var isIndexKey = function (key, length) {
  var index = key >>> 0;
  return '' + index === key && index < length;
};

var encode = function (value, maxBytes) {
  var out = '';
  var bytes = 0;

  // The size is checked while writing, so a huge value is rejected before it is fully built.
  var emit = function (chunk) {
    bytes += utf8Length(chunk);
    if (bytes > maxBytes) fail('OUTPUT_LIMIT_EXCEEDED', 'A value is larger than the limit "maxValueBytes".');
    out += chunk;
  };

  var writeNumber = function (number) {
    if (number !== number) emit('{"$":"nan"}');
    else if (number === Infinity) emit('{"$":"inf"}');
    else if (number === -Infinity) emit('{"$":"-inf"}');
    else if (ObjectIs(number, -0)) emit('{"$":"-0"}');
    else emit(JSONStringify(number));
  };

  var writeString = function (text) {
    if (text.length > maxBytes) fail('OUTPUT_LIMIT_EXCEEDED', 'A value is larger than the limit "maxValueBytes".');
    emit(JSONStringify(text));
  };

  var writeEntries = function (target, keys, top, depth) {
    sortStrings(keys);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      emit(i === 0 ? '[' : ',[');
      writeString(key);
      emit(',');
      writeValue(target[key], top, depth);
      emit(']');
    }
  };

  var writeObject = function (object, top, depth) {
    if (depth > MAX_DEPTH) fail('OUTPUT_LIMIT_EXCEEDED', 'A value is nested deeper than 256 levels.');

    // A reference to an ancestor is written as the depth of that ancestor, so two structurally equal
    // cyclic values have equal texts. A shared reference that is not a cycle is written in full.
    for (var up = top; up !== null; up = up.up) {
      if (up.object === object) {
        emit('{"$":"cyc","d":' + up.depth + '}');
        return;
      }
    }
    var frame = ObjectCreate(null);
    frame.object = object;
    frame.up = top;
    frame.depth = depth;
    var next = depth + 1;

    var tag = tagOf(object);

    if (tag === '[object Date]') {
      var time;
      var isDate = true;
      try { time = dateGetTime(object); } catch (ignored) { isDate = false; }
      if (isDate) {
        emit('{"$":"date","t":');
        writeNumber(time);
        emit('}');
        return;
      }
    } else if (tag === '[object RegExp]') {
      var source;
      var flags;
      var isRegExp = true;
      try { source = regExpSource(object); flags = regExpFlags(object); } catch (ignored) { isRegExp = false; }
      if (isRegExp) {
        emit('{"$":"re","s":');
        writeString(source);
        emit(',"f":');
        writeString(flags);
        emit('}');
        return;
      }
    } else if (tag === '[object Map]') {
      var firstEntry = true;
      emit('{"$":"map","e":[');
      mapForEach(object, function (item, key) {
        emit(firstEntry ? '[' : ',[');
        firstEntry = false;
        writeValue(key, frame, next);
        emit(',');
        writeValue(item, frame, next);
        emit(']');
      });
      emit(']}');
      return;
    } else if (tag === '[object Set]') {
      var firstItem = true;
      emit('{"$":"set","e":[');
      setForEach(object, function (item) {
        if (!firstItem) emit(',');
        firstItem = false;
        writeValue(item, frame, next);
      });
      emit(']}');
      return;
    } else if (tag === '[object Error]') {
      // Only the name and the message take part, as in the Verifier.
      emit('{"$":"err","n":');
      writeValue(object.name, frame, next);
      emit(',"m":');
      writeValue(object.message, frame, next);
      emit('}');
      return;
    }

    if (ArrayBufferIsView(object) && tag !== '[object DataView]') {
      var kind = stringSlice(tag, 8, -1);
      if (TYPED_ARRAYS[kind] !== undefined) {
        var count = typedArrayLength(object);
        emit('{"$":"ta","c":"' + kind + '","e":[');
        for (var t = 0; t < count; t++) {
          if (t > 0) emit(',');
          writeValue(object[t], frame, next);
        }
        emit(']}');
        return;
      }
    }

    var keys = ObjectKeys(object);

    if (ArrayIsArray(object)) {
      var length = object.length;
      emit('{"$":"arr","v":[');
      for (var i = 0; i < length; i++) {
        if (i > 0) emit(',');
        if (hasOwn(object, i)) writeValue(object[i], frame, next);
        else emit('{"$":"hole"}');
      }
      emit(']');
      // Own enumerable keys that are not indexes are rare on arrays, but they take part in equality.
      var extra = [];
      for (var k = 0; k < keys.length; k++) {
        if (!isIndexKey(keys[k], length)) ReflectDefineProperty(extra, extra.length, dataDescriptor(keys[k], true));
      }
      if (extra.length > 0) {
        emit(',"x":[');
        writeEntries(object, extra, frame, next);
        emit(']');
      }
      emit('}');
      return;
    }

    // Plain objects and every other object: own enumerable string keys, sorted by code unit.
    emit('{"$":"obj","e":[');
    writeEntries(object, keys, frame, next);
    emit(']}');
  };

  var writeValue = function (item, top, depth) {
    var type = typeof item;
    if (item === undefined) emit('{"$":"u"}');
    else if (item === null) emit('null');
    else if (type === 'boolean') emit(item ? 'true' : 'false');
    else if (type === 'number') writeNumber(item);
    else if (type === 'string') writeString(item);
    else if (type === 'bigint') emit('{"$":"big","v":"' + bigIntToString(item) + '"}');
    else if (type === 'function') emit('{"$":"function"}');
    else if (type === 'symbol') emit('{"$":"symbol"}');
    else writeObject(item, top, depth);
  };

  writeValue(value, null, 1);
  return out;
};

var isDecimal = function (text) {
  var start = stringCharCodeAt(text, 0) === 45 ? 1 : 0;
  if (text.length === start) return false;
  for (var i = start; i < text.length; i++) {
    var code = stringCharCodeAt(text, i);
    if (code < 48 || code > 57) return false;
  }
  return true;
};

var malformed = function () {
  fail('UNSUPPORTED_VALUE', 'The value text is malformed.');
};

var decode = function (text) {
  var build = function (node, depth) {
    var type = typeof node;
    if (node === null || type === 'string' || type === 'boolean' || type === 'number') return node;
    if (type !== 'object' || ArrayIsArray(node)) malformed();
    if (depth > MAX_DEPTH) fail('UNSUPPORTED_VALUE', 'The value is nested deeper than 256 levels.');

    var tag = ownValue(node, '$');
    var next = depth + 1;

    if (tag === 'u') return undefined;
    if (tag === 'nan') return NaN;
    if (tag === 'inf') return Infinity;
    if (tag === '-inf') return -Infinity;
    if (tag === '-0') return -0;

    if (tag === 'big') {
      var digits = ownValue(node, 'v');
      if (typeof digits !== 'string' || !isDecimal(digits)) malformed();
      return $BigInt(digits);
    }

    if (tag === 'arr') {
      var items = ownValue(node, 'v');
      if (!ArrayIsArray(items)) malformed();
      var array = new $Array(items.length);
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var isHole = typeof item === 'object' && item !== null && !ArrayIsArray(item) && ownValue(item, '$') === 'hole';
        if (!isHole) ReflectDefineProperty(array, i, dataDescriptor(build(item, next), true));
      }
      var extra = ownValue(node, 'x');
      if (extra !== undefined) defineEntries(array, extra, next);
      return array;
    }

    if (tag === 'obj') {
      var object = {};
      defineEntries(object, ownValue(node, 'e'), next);
      return object;
    }

    if (tag === 'date') {
      var time = build(ownValue(node, 't'), next);
      if (typeof time !== 'number') malformed();
      return new $Date(time);
    }

    if (tag === 're') {
      var source = ownValue(node, 's');
      var flags = ownValue(node, 'f');
      if (typeof source !== 'string' || typeof flags !== 'string') malformed();
      try {
        return new $RegExp(source, flags);
      } catch (ignored) {
        malformed();
      }
    }

    if (tag === 'map') {
      var pairs = ownValue(node, 'e');
      if (!ArrayIsArray(pairs)) malformed();
      var map = new $Map();
      for (var m = 0; m < pairs.length; m++) {
        var pair = pairs[m];
        if (!ArrayIsArray(pair) || pair.length !== 2) malformed();
        mapSet(map, build(pair[0], next), build(pair[1], next));
      }
      return map;
    }

    if (tag === 'set') {
      var members = ownValue(node, 'e');
      if (!ArrayIsArray(members)) malformed();
      var set = new $Set();
      for (var s = 0; s < members.length; s++) setAdd(set, build(members[s], next));
      return set;
    }

    if (tag === 'err') {
      var name = build(ownValue(node, 'n'), next);
      var message = build(ownValue(node, 'm'), next);
      var ErrorType = typeof name === 'string' && ERROR_TYPES[name] !== undefined ? ERROR_TYPES[name] : $Error;
      var error = new ErrorType();
      ReflectDefineProperty(error, 'name', dataDescriptor(name, false));
      ReflectDefineProperty(error, 'message', dataDescriptor(message, false));
      return error;
    }

    if (tag === 'ta') {
      var kind = ownValue(node, 'c');
      var elements = ownValue(node, 'e');
      if (typeof kind !== 'string' || TYPED_ARRAYS[kind] === undefined || !ArrayIsArray(elements)) malformed();
      var typed = new TYPED_ARRAYS[kind](elements.length);
      for (var t = 0; t < elements.length; t++) {
        var element = build(elements[t], next);
        if (typeof element !== 'number' && typeof element !== 'bigint') malformed();
        try {
          typed[t] = element;
        } catch (ignored) {
          malformed();
        }
      }
      return typed;
    }

    // "function", "symbol", "cyc", and a "hole" outside an array exist only in outputs.
    fail('UNSUPPORTED_VALUE', 'The value text has an unknown or output-only tag.');
  };

  var defineEntries = function (target, entries, depth) {
    if (!ArrayIsArray(entries)) malformed();
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!ArrayIsArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') malformed();
      // defineProperty makes a key such as "__proto__" an ordinary own property.
      ReflectDefineProperty(target, entry[0], dataDescriptor(build(entry[1], depth), true));
    }
  };

  var root;
  try {
    root = JSONParse(text);
  } catch (ignored) {
    malformed();
  }
  return build(root, 1);
};
