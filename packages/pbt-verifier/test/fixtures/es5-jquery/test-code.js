const textArbitrary = fc.string({
  unit: fc.constantFrom('a', 'B', 'c', 'A', ' ', ',', '\t'),
  maxLength: 30,
});

return fc.property(textArbitrary, (text) => {
  assertEquivalent(text);
});
