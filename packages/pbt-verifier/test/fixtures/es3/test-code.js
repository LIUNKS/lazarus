const numbersArbitrary = fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 20 });

return fc.property(numbersArbitrary, (numbers) => {
  assertEquivalent(numbers);
});
