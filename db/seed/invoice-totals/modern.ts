export interface InvoiceItem {
  price: number;
  quantity: number;
}

export interface InvoiceOrder {
  items: InvoiceItem[];
  taxRate: number;
  coupon: string;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function discountFor(coupon: string, subtotal: number): number {
  if (coupon === 'HALF') return subtotal / 2;
  if (coupon === 'TEN') return subtotal * 0.1;
  return 0;
}

export function computeInvoiceTotal(order: InvoiceOrder): InvoiceTotals {
  let subtotal = 0;
  for (const item of order.items) {
    if (item.quantity === 0) continue;
    subtotal += item.price * item.quantity;
  }

  const discount = discountFor(order.coupon, subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * order.taxRate;

  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    tax: round2(tax),
    total: round2(taxable + tax),
  };
}
