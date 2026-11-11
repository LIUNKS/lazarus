// Strings made of arbitrary UTF-16 units can contain lone surrogates, for which encodeURIComponent
// throws a URIError. Both implementations must then throw an error with the same name.
const valueArbitrary = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.string({ unit: 'binary', maxLength: 4 }),
  fc.integer(),
  fc.boolean(),
);

const paramsArbitrary = fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), valueArbitrary, {
  maxKeys: 6,
});

return fc.property(paramsArbitrary, (params) => {
  assertEquivalent(params);
});
