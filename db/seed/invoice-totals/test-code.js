const itemArbitrary = fc.record({
  price: fc.double({ min: -1000, max: 1000, noNaN: true }),
  quantity: fc.integer({ min: 0, max: 50 }),
});

const orderArbitrary = fc.record({
  items: fc.array(itemArbitrary, { maxLength: 8 }),
  taxRate: fc.double({ min: 0, max: 1, noNaN: true }),
  coupon: fc.constantFrom('', 'HALF', 'TEN', 'NONE'),
});

return fc.property(orderArbitrary, (order) => {
  assertEquivalent(order);
});
