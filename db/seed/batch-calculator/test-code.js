const jobArbitrary = fc.record({
  a: fc.double({ noNaN: true }),
  b: fc.double({ noNaN: true }),
  op: fc.constantFrom('+', '-', '*', '/', '%', '^', '**', 'x', ''),
});

return fc.property(fc.record({ jobs: fc.array(jobArbitrary, { maxLength: 5 }) }), (input) => {
  assertEquivalent(input);
});
