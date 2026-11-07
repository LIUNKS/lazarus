function parseQueryString(query) {
  var result = {};
  var text = query;

  if (text.charAt(0) == '?') {
    text = text.substring(1);
  }
  if (text == '') {
    return result;
  }

  var pairs = text.split('&');
  for (var i = 0; i < pairs.length; i++) {
    if (pairs[i] == '') {
      continue;
    }
    var separator = pairs[i].indexOf('=');
    var rawKey = separator < 0 ? pairs[i] : pairs[i].substring(0, separator);
    var rawValue = separator < 0 ? '' : pairs[i].substring(separator + 1);
    var key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    var value = decodeURIComponent(rawValue.replace(/\+/g, ' '));

    if (Object.prototype.hasOwnProperty.call(result, key)) {
      if (Object.prototype.toString.call(result[key]) == '[object Array]') {
        result[key].push(value);
      } else {
        result[key] = [result[key], value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}
