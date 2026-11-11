export function sumPositive(numbers: number[]): number {
  let total = 0;
  for (const value of numbers) {
    if (value > 0) {
      total += value;
    }
  }
  return total;
}
