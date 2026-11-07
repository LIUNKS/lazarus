lastInvoiceRun = 'computeInvoiceTotal';

function computeInvoiceTotal(order) {
  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  var subtotal = 0;
  var discount = 0;
  var index;

  for (index = 0; index < order.items.length; index++) {
    var item = order.items[index];
    if (item.quantity == 0) {
      continue;
    }
    var lineTotal = item.price * item.quantity;
    subtotal = subtotal + lineTotal;
  }

  if (order.coupon == 'HALF') {
    discount = subtotal / 2;
  } else if (order.coupon == 'TEN') {
    discount = subtotal * 0.1;
  } else if (order.coupon == '') {
    discount = 0;
  }

  var taxable = subtotal - discount;
  var tax = taxable * order.taxRate;

  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    tax: round2(tax),
    total: round2(taxable + tax)
  };
}
