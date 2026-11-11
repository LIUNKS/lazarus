/* eslint-disable */
// Trusted_Script fragment 4 (Driver_Context): runs the Test_Code with the bundled fast-check.
//
// The build places the fast-check bundle before this fragment, as the local variable `fc`. The
// Test_Code and fast-check share this context, so the author of hostile Test_Code can change the
// verdict of its own run. Nothing outside the run depends on that (see the Threat_Model).
//
// CONFIG: { apiName, legacyName, modernName, testName, numRuns, seed, allowDynamicCode, maxValueBytes }

var legacyApi = ownValue(globalThis, CONFIG.legacyName);
var modernApi = ownValue(globalThis, CONFIG.modernName);
var fcCheck = fc.check;
var fcStringify = fc.stringify;
var fcResetGlobal = fc.resetConfigureGlobal;

var MAX_INPUT_LENGTH = 2000;
var MAX_OUTCOME_LENGTH = 500;
var RETURNED_FALSE_MESSAGE = 'Property failed by returning false';
var OUTCOME_PREFIX_LENGTH = 13; // length of {"k":"r","v": and of {"k":"t","n":

// Progress marker: which side is running, and the last difference seen. The Worker reads it after a
// timeout, so a timeout during shrinking can still report the smallest counterexample recorded.
var progress = ObjectCreate(null);
progress.side = 'test';
progress.fatal = null;
progress.differences = 0;
progress.callsAtFirstDifference = 0;
progress.calls = 0;
progress.lastDifference = null;
progress.testForbidden = '';
progress.lastSideThrow = null;
progress.result = null;

var safeStringify = function (value) {
  try {
    return fcStringify(value);
  } catch (ignored) {
    return '[value that cannot be printed]';
  }
};

// A failure of the harness itself (a limit, an unsupported value). The first one is kept, because
// fast-check catches whatever a predicate throws and would otherwise treat it as a counterexample.
var abort = function (code, message) {
  if (progress.fatal === null) {
    var fatal = ObjectCreate(null);
    fatal.code = code;
    fatal.message = message;
    progress.fatal = fatal;
  }
  fail(code, message);
};

var encodeInput = function (input) {
  try {
    return encode(input, CONFIG.maxValueBytes);
  } catch (error) {
    if (isFailure(error)) abort('UNSUPPORTED_VALUE', 'A generated input cannot cross into the sandbox: ' + error.message);
    throw error;
  }
};

var callSide = function (api, side, inputText) {
  if (progress.fatal !== null) fail(progress.fatal.code, progress.fatal.message);
  progress.side = side;
  var outcome = api('call', inputText);
  progress.side = 'test';
  if (typeof outcome !== 'string') abort('SANDBOX_CRASH', 'The ' + side + ' adapter returned an invalid outcome.');
  if (stringSlice(outcome, 0, 8) === '{"k":"x"') {
    var record = JSONParse(outcome);
    var code = ownValue(record, 'c');
    var message = ownValue(record, 'm');
    abort(typeof code === 'string' ? code : 'SANDBOX_CRASH', 'In the ' + side + ' function: ' + (typeof message === 'string' ? message : 'unknown failure'));
  }
  return outcome;
};

var didThrow = function (outcome) {
  return stringSlice(outcome, 0, 8) === '{"k":"t"';
};
var thrownName = function (outcome) {
  return JSONParse(stringSlice(outcome, OUTCOME_PREFIX_LENGTH, -1));
};
var valueText = function (outcome) {
  return stringSlice(outcome, OUTCOME_PREFIX_LENGTH, -1);
};

var renderOutcome = function (outcome) {
  if (didThrow(outcome)) return truncate('threw: ' + thrownName(outcome), MAX_OUTCOME_LENGTH);
  var text = valueText(outcome);
  var shown;
  try {
    shown = safeStringify(decode(text));
  } catch (error) {
    if (!isFailure(error)) throw error;
    shown = text; // holds a function, a symbol, or a cycle: show the tagged text
  }
  return truncate('returned: ' + shown, MAX_OUTCOME_LENGTH);
};

// Each side builds its own copy from the same text, so a mutation by one function reaches neither the
// other function nor the generated value (Requirement 9, criterion 4).
var assertEquivalent = function (input) {
  var inputText = encodeInput(input);
  progress.calls += 1;
  var legacy = callSide(legacyApi, 'legacy', inputText);
  var modern = callSide(modernApi, 'modern', inputText);
  if (legacy === modern) return undefined;

  var difference = ObjectCreate(null);
  difference.legacy = renderOutcome(legacy);
  difference.modern = renderOutcome(modern);
  difference.input = truncate(safeStringify(input), MAX_INPUT_LENGTH);
  if (progress.differences === 0) progress.callsAtFirstDifference = progress.calls;
  progress.differences += 1;
  progress.lastDifference = difference;

  var error = new $Error('Behavioral difference. Legacy: ' + difference.legacy + '. Modern: ' + difference.modern + '.');
  ReflectDefineProperty(error, 'name', dataDescriptor('EquivalenceError', false));
  throw error;
};

// For Test_Code that calls a function directly: the value comes back as a copy in this context, and a
// throw becomes an Error that carries only the thrown name.
var directCall = function (api, side) {
  return function (input) {
    var outcome = callSide(api, side, encodeInput(input));
    if (didThrow(outcome)) {
      var name = thrownName(outcome);
      var error = new $Error('The ' + side + ' function threw ' + name + '.');
      ReflectDefineProperty(error, 'name', dataDescriptor('SideThrow', false));
      var record = ObjectCreate(null);
      record.error = error;
      record.side = side;
      record.name = name;
      progress.lastSideThrow = record;
      throw error;
    }
    try {
      return decode(valueText(outcome));
    } catch (failure) {
      if (isFailure(failure)) abort('UNSUPPORTED_VALUE', 'The ' + side + ' function returned a value that cannot be rebuilt (a function, a symbol, or a cycle).');
      throw failure;
    }
  };
};
var legacyFn = directCall(legacyApi, 'legacy');
var modernFn = directCall(modernApi, 'modern');

var errorResult = function (code, message) {
  return '{"t":"error","code":' + JSONStringify(code) + ',"message":' + JSONStringify(truncate(message, 500)) + '}';
};

var forbiddenResult = function () {
  var sides = ['legacy', 'modern', 'test'];
  var found = [legacyApi('forbidden'), modernApi('forbidden'), progress.testForbidden];
  for (var i = 0; i < 3; i++) {
    if (typeof found[i] === 'string' && found[i] !== '') {
      return errorResult('SANDBOX_FORBIDDEN_CAPABILITY', 'The ' + sides[i] + ' code used a denied capability: ' + truncate(found[i], 100) + '.');
    }
  }
  return null;
};

var testCodeError = function (prefix, thrown) {
  var record = readThrown(thrown);
  if (progress.testForbidden === '') progress.testForbidden = classifyForbidden(record);
  return forbiddenResult() || errorResult('TEST_CODE_ERROR', prefix + describeThrown(record));
};

var runCount = function (value) {
  return typeof value === 'number' ? value : 0;
};

var failedResult = function (runs, input, shrunk) {
  var difference = progress.lastDifference;
  return (
    '{"t":"failed","runs":' + runCount(runs) +
    ',"input":' + JSONStringify(input) +
    ',"legacy":' + JSONStringify(difference === null ? 'unavailable' : difference.legacy) +
    ',"modern":' + JSONStringify(difference === null ? 'unavailable' : difference.modern) +
    ',"shrunk":' + (shrunk ? 'true' : 'false') + '}'
  );
};

var renderCounterexample = function (args) {
  var input = ArrayIsArray(args) && args.length === 1 ? args[0] : args;
  return truncate(safeStringify(input), MAX_INPUT_LENGTH);
};

// Same order of decisions as the Verifier of 03-pbt-verifier.
var classify = function (details) {
  if (progress.fatal !== null && progress.differences === 0) return errorResult(progress.fatal.code, progress.fatal.message);
  var forbidden = forbiddenResult();
  if (forbidden !== null) return forbidden;
  if (details.failed !== true) return '{"t":"passed","runs":' + runCount(details.numRuns) + '}';

  var cause = details.errorInstance;
  if (details.interrupted === true || cause === null || cause === undefined) {
    return errorResult('TEST_CODE_ERROR', 'The property could not generate enough valid inputs. Check the preconditions (fc.pre) of the test code.');
  }
  var record = readThrown(cause);
  if (progress.differences > 0 || record.message === RETURNED_FALSE_MESSAGE) {
    return failedResult(details.numRuns, renderCounterexample(details.counterexample), details.numShrinks > 0);
  }
  var sideThrow = progress.lastSideThrow;
  if (sideThrow !== null && sideThrow.error === cause) {
    return errorResult('TEST_CODE_ERROR', 'The test code called the ' + sideThrow.side + ' function directly and it threw ' + truncate(sideThrow.name, 100) + '. Compare outcomes through assertEquivalent so that a thrown error is part of the comparison.');
  }
  return testCodeError('The test code threw an unexpected error: ', cause);
};

var isProperty = function (value) {
  return (
    typeof value === 'object' && value !== null &&
    typeof value.generate === 'function' && typeof value.run === 'function' && typeof value.isAsync === 'function'
  );
};

var run = function () {
  var build = ownValue(globalThis, CONFIG.testName);
  var property;
  try {
    property = build(fc, legacyFn, modernFn, assertEquivalent, CONFIG.numRuns);
  } catch (error) {
    if (isFailure(error)) return errorResult(error.code, error.message);
    return testCodeError('The test code threw while building the property: ', error);
  }
  if (!isProperty(property)) {
    return errorResult('TEST_CODE_ERROR', 'The test code did not return a fast-check property. End it with "return fc.property(...)".');
  }

  // The Test_Code controls neither the run count nor the seed: global settings it may have changed
  // are reset, and only these two parameters are passed.
  var parameters = ObjectCreate(null);
  parameters.numRuns = CONFIG.numRuns;
  parameters.seed = CONFIG.seed;
  var details;
  try {
    fcResetGlobal();
    details = fcCheck(property, parameters);
  } catch (error) {
    if (isFailure(error)) return errorResult(error.code, error.message);
    return testCodeError('The test code threw an unexpected error: ', error);
  }

  var isAsync = false;
  try { isAsync = property.isAsync() === true; } catch (ignored) {}
  if (!isAsync) return classify(details);

  // An async property is supported only when it settles by microtasks, which run before this
  // evaluation returns. The Worker asks for the result with "collect" afterwards.
  promiseThen(details, function (settled) {
    progress.result = classify(settled);
  }, function (error) {
    progress.result = isFailure(error) ? errorResult(error.code, error.message) : testCodeError('The test code threw an unexpected error: ', error);
  });
  return null;
};

var progressText = function () {
  var difference = progress.lastDifference;
  if (difference === null) return '{"side":' + JSONStringify(progress.side) + '}';
  return (
    '{"side":' + JSONStringify(progress.side) +
    ',"failed":' + failedResult(progress.callsAtFirstDifference, difference.input, progress.differences > 1) + '}'
  );
};

var api = function (operation) {
  if (operation === 'run') {
    progress.result = run();
    return '';
  }
  if (operation === 'collect') {
    if (progress.result !== null) return progress.result;
    return errorResult('TEST_CODE_ERROR', 'The property did not settle. Asynchronous work outside microtasks is not supported.');
  }
  if (operation === 'progress') return progressText();
  return '';
};

var apiDescriptor = ObjectCreate(null);
apiDescriptor.value = api;
apiDescriptor.writable = false;
apiDescriptor.enumerable = false;
apiDescriptor.configurable = false;
ReflectDefineProperty(globalThis, CONFIG.apiName, apiDescriptor);
