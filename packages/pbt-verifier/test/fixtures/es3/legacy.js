// ES3 style: var declarations, index loops, no ES5 array methods.
function sumPositive(numbers) {
  var total = 0;
  var i;
  for (i = 0; i < numbers.length; i++) {
    if (numbers[i] > 0) {
      total = total + numbers[i];
    }
  }
  return total;
}
