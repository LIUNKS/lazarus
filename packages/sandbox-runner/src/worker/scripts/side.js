/* eslint-disable */
// Trusted_Script fragment 3 (Legacy_Context and Modern_Context): the side adapter.
//
// It decodes an input into a fresh copy built in this context, calls the Entry_Function, and returns
// the outcome as text. Its only binding on the global object is one function under a per-run random
// name. Hostile code can find that name and call the function; the effect is limited to the verdict
// of its own run (see the Threat_Model).
//
// CONFIG: { side, apiName, allowDynamicCode, maxValueBytes }

var entryFunction;
var stashedThrown;
var forbiddenCapability = '';

var noteThrown = function (thrown) {
  var record = readThrown(thrown);
  if (forbiddenCapability === '') forbiddenCapability = classifyForbidden(record);
  return record;
};

// The outcome text is the Canonical_Form of the outcome:
//   {"k":"r","v":<Tagged_Value>}   the function returned
//   {"k":"t","n":"<name>"}         the function threw
//   {"k":"x","c":"<code>","m":"<message>"}   the adapter itself could not finish (a limit, a bad input)
var failureText = function (code, message) {
  return '{"k":"x","c":' + JSONStringify(code) + ',"m":' + JSONStringify(message) + '}';
};

var callEntry = function (inputText) {
  try {
    var input = decode(inputText);
    var returned;
    var thrown;
    var threw = false;
    try {
      returned = entryFunction(input);
    } catch (error) {
      threw = true;
      thrown = error;
    }
    if (threw) {
      var record = noteThrown(thrown);
      var name = record.name === null ? 'non-error' : truncate(record.name, 200);
      return '{"k":"t","n":' + JSONStringify(name) + '}';
    }
    // A Promise is an ordinary returned object here. It is never awaited (Requirement 8, criterion 6).
    return '{"k":"r","v":' + encode(returned, CONFIG.maxValueBytes) + '}';
  } catch (error) {
    if (isFailure(error)) return failureText(error.code, error.message);
    return failureText('SANDBOX_CRASH', 'The ' + CONFIG.side + ' adapter could not finish a call.');
  }
};

// A short text for one value in cases mode, written from the Tagged_Value text.
var renderNode = function (node, budget) {
  if (budget.left <= 0) return '';
  var text;
  var type = typeof node;
  if (node === null) text = 'null';
  else if (type === 'string') text = JSONStringify(node);
  else if (type === 'number' || type === 'boolean') text = '' + node;
  else {
    var tag = ownValue(node, '$');
    if (tag === 'u') text = 'undefined';
    else if (tag === 'nan') text = 'NaN';
    else if (tag === 'inf') text = 'Infinity';
    else if (tag === '-inf') text = '-Infinity';
    else if (tag === '-0') text = '-0';
    else if (tag === 'big') text = ownValue(node, 'v') + 'n';
    else if (tag === 'function') text = '[Function]';
    else if (tag === 'symbol') text = '[Symbol]';
    else if (tag === 'cyc') text = '[Circular]';
    else if (tag === 'hole') text = '';
    else if (tag === 'date') text = 'Date(' + renderNode(ownValue(node, 't'), budget) + ')';
    else if (tag === 're') text = '/' + ownValue(node, 's') + '/' + ownValue(node, 'f');
    else if (tag === 'err') text = 'Error(' + renderNode(ownValue(node, 'n'), budget) + ', ' + renderNode(ownValue(node, 'm'), budget) + ')';
    else if (tag === 'arr' || tag === 'set' || tag === 'ta') {
      var items = ownValue(node, tag === 'arr' ? 'v' : 'e');
      text = tag === 'arr' ? '[' : tag === 'set' ? 'Set[' : ownValue(node, 'c') + '[';
      for (var i = 0; i < items.length && budget.left > 0; i++) text += (i > 0 ? ',' : '') + renderNode(items[i], budget);
      text += ']';
    } else if (tag === 'obj' || tag === 'map') {
      var entries = ownValue(node, 'e');
      text = tag === 'obj' ? '{' : 'Map{';
      for (var e = 0; e < entries.length && budget.left > 0; e++) {
        var key = entries[e][0];
        text += (e > 0 ? ',' : '') + (tag === 'obj' ? JSONStringify(key) : renderNode(key, budget)) + ':' + renderNode(entries[e][1], budget);
      }
      text += '}';
    } else text = '[unknown]';
  }
  budget.left -= text.length;
  return text;
};

var renderValue = function (valueText) {
  try {
    var budget = ObjectCreate(null);
    budget.left = 400;
    return truncate(renderNode(JSONParse(valueText), budget), 200);
  } catch (ignored) {
    return '[value that cannot be printed]';
  }
};

var api = function (operation, argument) {
  if (operation === 'call') return callEntry(argument);
  if (operation === 'bind') {
    entryFunction = typeof argument === 'function' ? argument : undefined;
    return entryFunction !== undefined;
  }
  if (operation === 'stash') {
    stashedThrown = argument;
    return true;
  }
  if (operation === 'describe') {
    var description = describeThrown(noteThrown(stashedThrown));
    stashedThrown = undefined;
    return description;
  }
  if (operation === 'forbidden') return forbiddenCapability;
  if (operation === 'render') return renderValue(argument);
  return '';
};

var apiDescriptor = ObjectCreate(null);
apiDescriptor.value = api;
apiDescriptor.writable = false;
apiDescriptor.enumerable = false;
apiDescriptor.configurable = false;
ReflectDefineProperty(globalThis, CONFIG.apiName, apiDescriptor);

// Transpiled Modern_Code is CommonJS: it writes to `exports`. This object is the only extra binding.
if (CONFIG.side === 'modern') ReflectDefineProperty(globalThis, 'exports', dataDescriptor({}, false));
