/*
 * Storyweave engine
 * A tiny, dependency-free renderer and variable runtime for interactive fiction.
 * The same functions are inlined into exported stories, so keep this file free of
 * references to globals or editor-only helpers.
 */
(function (global) {
  'use strict';

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function formatValue(value) {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
      if (!isFinite(value)) return '0';
      return String(Math.round(value * 1000000) / 1000000);
    }
    return String(value);
  }

  function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0 && !isNaN(value);
    if (value == null) return false;
    var text = String(value).trim();
    if (!text) return false;
    var lower = text.toLowerCase();
    return lower !== 'false' && lower !== '0';
  }

  function toNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value == null || value === '') return 0;
    var number = Number(value);
    return isFinite(number) ? number : 0;
  }

  function numericValue(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
      return Number(value);
    }
    return null;
  }

  function variableKey(name) {
    var key = String(name == null ? '' : name).trim();
    if (/^var:/i.test(key)) return key.slice(4);
    if (/^item:/i.test(key)) return key.slice(5);
    return key;
  }

  function trimOuterParens(text) {
    var result = String(text == null ? '' : text).trim();
    while (result.charAt(0) === '(' && result.charAt(result.length - 1) === ')') {
      var depth = 0;
      var quote = null;
      var enclosesAll = true;
      for (var i = 0; i < result.length; i++) {
        var character = result.charAt(i);
        if (quote) {
          if (character === '\\') i++;
          else if (character === quote) quote = null;
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
        } else if (character === '(') {
          depth++;
        } else if (character === ')') {
          depth--;
          if (depth === 0 && i < result.length - 1) {
            enclosesAll = false;
            break;
          }
        }
      }
      if (!enclosesAll) break;
      result = result.slice(1, -1).trim();
    }
    return result;
  }

  function splitTopLevel(text, separators) {
    var source = String(text == null ? '' : text);
    var parts = [];
    var start = 0;
    var depth = 0;
    var quote = null;
    var i = 0;

    while (i < source.length) {
      var character = source.charAt(i);
      if (quote) {
        if (character === '\\') i++;
        else if (character === quote) quote = null;
        i++;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        i++;
        continue;
      }
      if (character === '(') {
        depth++;
        i++;
        continue;
      }
      if (character === ')') {
        depth--;
        i++;
        continue;
      }
      if (depth === 0) {
        var found = null;
        for (var s = 0; s < separators.length; s++) {
          var separator = separators[s];
          if (source.slice(i, i + separator.length).toLowerCase() === separator.toLowerCase()) {
            found = separator;
            break;
          }
        }
        if (found) {
          parts.push(source.slice(start, i).trim());
          i += found.length;
          start = i;
          continue;
        }
      }
      i++;
    }
    parts.push(source.slice(start).trim());
    return parts.filter(function (part) { return part.length > 0; });
  }

  function parseTag(raw) {
    var source = String(raw == null ? '' : raw).trim();
    if (!source) return null;

    if (source.charAt(0) === '/') {
      var closeName = source.slice(1).trim().toLowerCase();
      if (/^[a-z]+$/.test(closeName)) return { kind: 'close', name: closeName, arg: '' };
      return null;
    }

    var colonTag = source.match(/^([A-Za-z]+):([\s\S]*)$/);
    var match = colonTag || source.match(/^([A-Za-z]+)(?:\s*=\s*|\s+)?([\s\S]*)$/);
    if (!match) return null;
    var name = match[1].toLowerCase();
    var arg = (match[2] || '').trim();

    if (name === 'else' || name === 'set' || name === 'var' || name === 'item'
      || name === 'br' || name === 'hr' || name === 'img' || name === 'image') {
      return { kind: 'self', name: name, arg: arg };
    }
    return { kind: 'open', name: name, arg: arg };
  }

  function sanitizeColor(value) {
    var color = String(value == null ? '' : value).trim();
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
    if (/^[a-z]+$/i.test(color)) return color.toLowerCase();
    if (/^(?:rgb|hsl)a?\([0-9.,%\s/+-]+\)$/i.test(color)) return color;
    return null;
  }

  function getFormatDescriptor(name, arg) {
    var tag = '';
    var className = '';
    switch (name) {
      case 'b':
      case 'strong':
        tag = 'strong';
        break;
      case 'i':
      case 'em':
        tag = 'em';
        break;
      case 'u':
        tag = 'u';
        break;
      case 's':
      case 'strike':
      case 'del':
        tag = 's';
        break;
      case 'big':
        tag = 'span';
        className = 'sw-big';
        break;
      case 'small':
        tag = 'span';
        className = 'sw-small';
        break;
      case 'mark':
      case 'highlight':
        tag = 'mark';
        break;
      case 'center':
        tag = 'span';
        className = 'sw-center';
        break;
      case 'quote':
        tag = 'span';
        className = 'sw-quote';
        break;
      case 'code':
        tag = 'code';
        break;
      case 'heading':
        tag = 'span';
        className = 'sw-heading';
        break;
      case 'accent':
        tag = 'span';
        className = 'sw-accent';
        break;
      case 'muted':
        tag = 'span';
        className = 'sw-muted';
        break;
      case 'color':
        var color = sanitizeColor(arg);
        if (!color) return null;
        return { name: name, open: '<span style="color:' + color + '">', close: '</span>' };
      default:
        return null;
    }
    var open = '<' + tag + (className ? ' class="' + className + '"' : '') + '>';
    return { name: name, open: open, close: '</' + tag + '>' };
  }

  function getChildren(node) {
    return node.type === 'if' && node.inElse && node.elseChildren ? node.elseChildren : node.children;
  }

  function resolveExpr(expression, vars) {
    var values = vars && typeof vars === 'object' ? vars : {};
    var source = String(expression == null ? '' : expression);
    var tokens = [];
    var i = 0;

    while (i < source.length) {
      var character = source.charAt(i);
      if (/\s/.test(character)) {
        i++;
        continue;
      }
      if (character === '"' || character === "'") {
        var quote = character;
        var value = '';
        i++;
        while (i < source.length && source.charAt(i) !== quote) {
          if (source.charAt(i) === '\\' && i + 1 < source.length) {
            var escaped = source.charAt(i + 1);
            if (escaped === 'n') value += '\n';
            else if (escaped === 't') value += '\t';
            else value += escaped;
            i += 2;
          } else {
            value += source.charAt(i);
            i++;
          }
        }
        i++;
        tokens.push({ type: 'string', value: value });
        continue;
      }
      var numberMatch = source.slice(i).match(/^(?:\d+\.?\d*|\.\d+)/);
      if (numberMatch) {
        tokens.push({ type: 'number', value: Number(numberMatch[0]) });
        i += numberMatch[0].length;
        continue;
      }
      var identifierMatch = source.slice(i).match(/^(?:var:|item:)?[A-Za-z_][A-Za-z0-9_]*/i);
      if (identifierMatch) {
        tokens.push({ type: 'id', value: identifierMatch[0] });
        i += identifierMatch[0].length;
        continue;
      }
      if ('+-*/%()!'.indexOf(character) !== -1) {
        tokens.push({ type: 'op', value: character });
        i++;
        continue;
      }
      throw new Error('Unexpected character in expression.');
    }

    var position = 0;

    function peek() {
      return tokens[position] || null;
    }

    function parsePrimary() {
      var token = peek();
      if (!token) throw new Error('Unexpected end of expression.');
      if (token.type === 'number' || token.type === 'string') {
        position++;
        return token.value;
      }
      if (token.type === 'id') {
        position++;
        var lower = token.value.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
        if (lower === 'null') return null;
        if (lower === 'not') return !toBoolean(parseUnary());
        var key = variableKey(token.value);
        return hasOwn(values, key) ? values[key] : '';
      }
      if (token.type === 'op' && token.value === '(') {
        position++;
        var grouped = parseAddition();
        if (peek() && peek().value === ')') position++;
        return grouped;
      }
      throw new Error('Unexpected token in expression.');
    }

    function parseUnary() {
      var token = peek();
      if (token && token.type === 'op' && (token.value === '-' || token.value === '+' || token.value === '!')) {
        position++;
        var unaryValue = parseUnary();
        if (token.value === '-') return -toNumber(unaryValue);
        if (token.value === '!') return !toBoolean(unaryValue);
        return toNumber(unaryValue);
      }
      return parsePrimary();
    }

    function parseMultiplication() {
      var result = parseUnary();
      while (peek() && peek().type === 'op' && '*/%'.indexOf(peek().value) !== -1) {
        var operator = tokens[position++].value;
        var right = parseUnary();
        if (operator === '*') result = toNumber(result) * toNumber(right);
        else if (operator === '/') {
          var divisor = toNumber(right);
          result = divisor === 0 ? 0 : toNumber(result) / divisor;
        } else {
          var modulus = toNumber(right);
          result = modulus === 0 ? 0 : toNumber(result) % modulus;
        }
      }
      return result;
    }

    function parseAddition() {
      var result = parseMultiplication();
      while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        var operator = tokens[position++].value;
        var right = parseMultiplication();
        if (operator === '+') {
          if (typeof result === 'string' || typeof right === 'string') {
            result = formatValue(result) + formatValue(right);
          } else {
            result = toNumber(result) + toNumber(right);
          }
        } else {
          result = toNumber(result) - toNumber(right);
        }
      }
      return result;
    }

    try {
      return parseAddition();
    } catch (error) {
      return '';
    }
  }

  function findComparison(text) {
    var source = String(text == null ? '' : text);
    var depth = 0;
    var quote = null;
    var symbols = [
      ['>=', '>='],
      ['<=', '<='],
      ['==', '=='],
      ['!=', '!='],
      ['>', '>'],
      ['<', '<'],
      ['=', '==']
    ];
    var words = [
      [' is not ', '!='],
      [' contains ', 'contains'],
      [' is ', '==']
    ];

    for (var i = 0; i < source.length; i++) {
      var character = source.charAt(i);
      if (quote) {
        if (character === '\\') i++;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '(') {
        depth++;
        continue;
      }
      if (character === ')') {
        depth--;
        continue;
      }
      if (depth !== 0) continue;

      var rest = source.slice(i);
      for (var s = 0; s < symbols.length; s++) {
        if (rest.slice(0, symbols[s][0].length) === symbols[s][0]) {
          return {
            left: source.slice(0, i).trim(),
            op: symbols[s][1],
            right: rest.slice(symbols[s][0].length).trim()
          };
        }
      }
      var lower = rest.toLowerCase();
      for (var w = 0; w < words.length; w++) {
        if (lower.slice(0, words[w][0].length) === words[w][0]) {
          return {
            left: source.slice(0, i).trim(),
            op: words[w][1],
            right: rest.slice(words[w][0].length).trim()
          };
        }
      }
    }
    return null;
  }

  function valuesEqual(left, right) {
    var leftNumber = numericValue(left);
    var rightNumber = numericValue(right);
    if (leftNumber != null && rightNumber != null) return leftNumber === rightNumber;
    return formatValue(left) === formatValue(right);
  }

  function compareValues(left, operator, right) {
    if (operator === 'contains') {
      return formatValue(left).toLowerCase().indexOf(formatValue(right).toLowerCase()) !== -1;
    }
    if (operator === '==') return valuesEqual(left, right);
    if (operator === '!=') return !valuesEqual(left, right);

    var leftNumber = numericValue(left);
    var rightNumber = numericValue(right);
    if (leftNumber != null && rightNumber != null) {
      if (operator === '>') return leftNumber > rightNumber;
      if (operator === '<') return leftNumber < rightNumber;
      if (operator === '>=') return leftNumber >= rightNumber;
      if (operator === '<=') return leftNumber <= rightNumber;
    }

    var leftText = formatValue(left);
    var rightText = formatValue(right);
    if (operator === '>') return leftText > rightText;
    if (operator === '<') return leftText < rightText;
    if (operator === '>=') return leftText >= rightText;
    if (operator === '<=') return leftText <= rightText;
    return false;
  }

  function evalCondition(condition, vars) {
    var values = vars && typeof vars === 'object' ? vars : {};
    var text = String(condition == null ? '' : condition).trim();
    if (!text) return true;
    text = trimOuterParens(text);
    if (!text) return true;

    var orParts = splitTopLevel(text, ['||', ' or ']);
    if (orParts.length > 1) {
      return orParts.some(function (part) { return evalCondition(part, values); });
    }

    var andParts = splitTopLevel(text, ['&&', ' and ']);
    if (andParts.length > 1) {
      return andParts.every(function (part) { return evalCondition(part, values); });
    }

    if (/^not\s+/i.test(text)) return !evalCondition(text.replace(/^not\s+/i, ''), values);
    if (text.charAt(0) === '!') return !evalCondition(text.slice(1), values);

    var comparison = findComparison(text);
    if (comparison && comparison.left) {
      return compareValues(
        resolveExpr(comparison.left, values),
        comparison.op,
        resolveExpr(comparison.right, values)
      );
    }

    return toBoolean(resolveExpr(text, values));
  }

  function splitStatements(source) {
    var lines = String(source == null ? '' : source).split(/\r?\n/);
    var statements = [];
    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed || trimmed.charAt(0) === '#' || trimmed.slice(0, 2) === '//') return;
      splitTopLevel(trimmed, [';']).forEach(function (statement) {
        if (statement.trim()) statements.push(statement.trim());
      });
    });
    return statements;
  }

  function applyEffectLine(statement, vars) {
    var line = String(statement == null ? '' : statement).trim();
    if (!line) return false;

    var increment = line.match(/^((?:var:|item:)?[A-Za-z_][A-Za-z0-9_]*)\s*(\+\+|--)$/i);
    if (increment) {
      var incrementKey = variableKey(increment[1]);
      var current = hasOwn(vars, incrementKey) ? vars[incrementKey] : 0;
      vars[incrementKey] = toNumber(current) + (increment[2] === '++' ? 1 : -1);
      return true;
    }

    var match = line.match(/^((?:var:|item:)?[A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|\*=|\/=|=)\s*([\s\S]*)$/i);
    if (!match) return false;

    var name = variableKey(match[1]);
    var operator = match[2];
    var right = resolveExpr(match[3], vars);
    var previous = hasOwn(vars, name) ? vars[name] : '';

    if (operator === '=') {
      vars[name] = right;
    } else if (operator === '+=') {
      if (typeof previous === 'string' || typeof right === 'string') {
        vars[name] = formatValue(previous) + formatValue(right);
      } else {
        vars[name] = toNumber(previous) + toNumber(right);
      }
    } else if (operator === '-=') {
      vars[name] = toNumber(previous) - toNumber(right);
    } else if (operator === '*=') {
      vars[name] = toNumber(previous) * toNumber(right);
    } else if (operator === '/=') {
      var divisor = toNumber(right);
      vars[name] = divisor === 0 ? 0 : toNumber(previous) / divisor;
    }
    return true;
  }

  function applyEffects(source, vars) {
    var values = vars && typeof vars === 'object' ? vars : {};
    splitStatements(source).forEach(function (statement) {
      applyEffectLine(statement, values);
    });
    return values;
  }

  function createVariables(definitions) {
    var values = Object.create(null);
    if (!Array.isArray(definitions)) return values;
    definitions.forEach(function (definition) {
      var name = String(definition && definition.name ? definition.name : '').trim();
      if (!name) return;
      var type = definition.type || 'text';
      var initial = definition.initial;
      if (type === 'number' || type === 'item' || type === 'resource') values[name] = toNumber(initial);
      else if (type === 'boolean') {
        values[name] = initial === true || String(initial).toLowerCase() === 'true';
      } else {
        values[name] = initial == null ? '' : String(initial);
      }
    });
    return values;
  }

  function parseMarkup(source) {
    var text = String(source == null ? '' : source);
    var root = { type: 'root', children: [] };
    var stack = [root];
    var buffer = '';
    var index = 0;

    function currentChildren() {
      return getChildren(stack[stack.length - 1]);
    }

    function flush() {
      if (!buffer) return;
      currentChildren().push({ type: 'text', value: buffer });
      buffer = '';
    }

    while (index < text.length) {
      var character = text.charAt(index);
      if (character === '\\' && text.charAt(index + 1) === '[') {
        buffer += '[';
        index += 2;
        continue;
      }
      if (character !== '[') {
        buffer += character;
        index++;
        continue;
      }

      var end = text.indexOf(']', index + 1);
      if (end === -1) {
        buffer += character;
        index++;
        continue;
      }

      var raw = text.slice(index + 1, end);
      var tag = parseTag(raw);
      if (!tag) {
        buffer += text.slice(index, end + 1);
        index = end + 1;
        continue;
      }

      if (tag.kind === 'open') {
        flush();
        if (tag.name === 'if') {
          var conditionNode = {
            type: 'if',
            cond: tag.arg,
            children: [],
            elseChildren: null,
            inElse: false
          };
          currentChildren().push(conditionNode);
          stack.push(conditionNode);
        } else {
          var descriptor = getFormatDescriptor(tag.name, tag.arg);
          if (descriptor) {
            var formatNode = { type: 'format', desc: descriptor, children: [] };
            currentChildren().push(formatNode);
            stack.push(formatNode);
          } else {
            buffer += text.slice(index, end + 1);
          }
        }
      } else if (tag.kind === 'close') {
        if (tag.name === 'if') {
          var ifIndex = -1;
          for (var i = stack.length - 1; i > 0; i--) {
            if (stack[i].type === 'if') {
              ifIndex = i;
              break;
            }
          }
          if (ifIndex !== -1) {
            flush();
            stack.length = ifIndex;
          } else {
            buffer += text.slice(index, end + 1);
          }
        } else {
          var formatIndex = -1;
          for (var j = stack.length - 1; j > 0; j--) {
            if (stack[j].type === 'format' && stack[j].desc.name === tag.name) {
              formatIndex = j;
              break;
            }
          }
          if (formatIndex !== -1) {
            flush();
            stack.length = formatIndex;
          } else {
            buffer += text.slice(index, end + 1);
          }
        }
      } else {
        flush();
        if (tag.name === 'set' && tag.arg) {
          currentChildren().push({ type: 'set', expr: tag.arg });
        } else if ((tag.name === 'var' || tag.name === 'item') && tag.arg) {
          currentChildren().push({ type: 'var', name: tag.arg });
        } else if ((tag.name === 'img' || tag.name === 'image') && tag.arg) {
          currentChildren().push({ type: 'image', name: tag.arg });
        } else if (tag.name === 'else') {
          var top = stack[stack.length - 1];
          if (top.type === 'if' && !top.inElse) {
            top.inElse = true;
            top.elseChildren = [];
          } else {
            buffer += text.slice(index, end + 1);
          }
        } else if (tag.name === 'br') {
          buffer += '\n';
        } else if (tag.name === 'hr') {
          currentChildren().push({ type: 'html', value: '<hr class="sw-divider">' });
        } else {
          buffer += text.slice(index, end + 1);
        }
      }

      index = end + 1;
    }

    flush();
    return root.children;
  }

  function renderNodes(nodes, vars, assets) {
    var output = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.type === 'text') {
        output += escapeHTML(node.value);
      } else if (node.type === 'html') {
        output += node.value;
      } else if (node.type === 'var') {
        var key = variableKey(node.name);
        var value = hasOwn(vars, key) ? vars[key] : '';
        output += escapeHTML(formatValue(value));
      } else if (node.type === 'set') {
        applyEffects(node.expr, vars);
      } else if (node.type === 'image') {
        var asset = assets && typeof assets === 'object' ? assets[node.name] : null;
        if (asset && asset.src) {
          output += '<img class="sw-image" src="' + escapeHTML(asset.src) + '" alt="' + escapeHTML(asset.name || '') + '">';
        } else {
          output += '<span class="sw-image-missing">Image unavailable</span>';
        }
      } else if (node.type === 'format') {
        output += node.desc.open + renderNodes(node.children, vars, assets) + node.desc.close;
      } else if (node.type === 'if') {
        if (evalCondition(node.cond, vars)) {
          output += renderNodes(node.children, vars, assets);
        } else if (node.elseChildren) {
          output += renderNodes(node.elseChildren, vars, assets);
        }
      }
    }
    return output;
  }

  function renderMarkup(source, vars, assets) {
    var values = vars && typeof vars === 'object' ? vars : {};
    return renderNodes(parseMarkup(source), values, assets);
  }

  var api = {
    escapeHTML: escapeHTML,
    formatValue: formatValue,
    toBoolean: toBoolean,
    toNumber: toNumber,
    renderMarkup: renderMarkup,
    evalCondition: evalCondition,
    applyEffects: applyEffects,
    createVariables: createVariables,
    resolveExpr: resolveExpr
  };

  /*
   * This source is inserted verbatim into standalone story exports.
   * It contains only self-contained function declarations.
   */
  api.source = [
    escapeHTML,
    hasOwn,
    formatValue,
    toBoolean,
    toNumber,
    numericValue,
    variableKey,
    trimOuterParens,
    splitTopLevel,
    parseTag,
    sanitizeColor,
    getFormatDescriptor,
    getChildren,
    resolveExpr,
    findComparison,
    valuesEqual,
    compareValues,
    evalCondition,
    splitStatements,
    applyEffectLine,
    applyEffects,
    createVariables,
    parseMarkup,
    renderNodes,
    renderMarkup
  ].map(function (fn) { return fn.toString(); }).join('\n\n');

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.StoryEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
