// Legacy Node style: the helper that built query strings before URLSearchParams existed.
// It touches no module, no global, and no I/O, so it can be called in isolation.
function buildQuery(params) {
  var keys = Object.keys(params).sort();
  var parts = [];
  var i;
  for (i = 0; i < keys.length; i++) {
    parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(String(params[keys[i]])));
  }
  return parts.join('&');
}
