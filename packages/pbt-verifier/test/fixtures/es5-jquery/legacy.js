// ES5 style, as found next to jQuery code: chained array methods and function expressions.
// The sample format forbids `$` and `jQuery`, so the trimming is written by hand.
function normalizeTags(text) {
  return text
    .split(',')
    .map(function (part) {
      return part.replace(/^\s+|\s+$/g, '').toLowerCase();
    })
    .filter(function (tag, index, all) {
      return tag.length > 0 && all.indexOf(tag) === index;
    });
}
