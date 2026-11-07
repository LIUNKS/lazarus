const tokenArbitrary = fc.constantFrom(
  'a', 'b', 'key', '=', '&', '?', '+', '%20', '%', '%zz', '1', '__proto__', 'constructor', 'toString'
);

const rawQueryArbitrary = fc
  .array(tokenArbitrary, { maxLength: 14 })
  .map((tokens) => tokens.join(''));

const encodedPairArbitrary = fc
  .tuple(fc.string({ maxLength: 6 }), fc.string({ maxLength: 6 }))
  .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value));

const structuredQueryArbitrary = fc
  .array(encodedPairArbitrary, { maxLength: 6 })
  .map((pairs) => pairs.join('&'));

return fc.property(fc.oneof(rawQueryArbitrary, structuredQueryArbitrary), (query) => {
  assertEquivalent(query);
});
