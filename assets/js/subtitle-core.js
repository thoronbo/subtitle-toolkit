/*!
 * 字幕工坊 Subtitle Toolkit — 核心处理逻辑
 * Copyright (c) 2026 深维工坊工作室 Deep Dimension Workshop
 * Released under the MIT License.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SubtitleCore = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMATS = ['srt', 'vtt', 'ass'];

  /* ------------------------------------------------------------------ *
   * 时间码
   * ------------------------------------------------------------------ */

  function pad(num, width) {
    var s = String(num);
    while (s.length < width) s = '0' + s;
    return s;
  }

  function msToParts(ms) {
    ms = Math.max(0, Math.round(ms));
    return {
      h: Math.floor(ms / 3600000),
      m: Math.floor((ms % 3600000) / 60000),
      s: Math.floor((ms % 60000) / 1000),
      ms: ms % 1000
    };
  }

  function formatSrt(ms) {
    var p = msToParts(ms);
    return pad(p.h, 2) + ':' + pad(p.m, 2) + ':' + pad(p.s, 2) + ',' + pad(p.ms, 3);
  }

  function formatVtt(ms) {
    var p = msToParts(ms);
    return pad(p.h, 2) + ':' + pad(p.m, 2) + ':' + pad(p.s, 2) + '.' + pad(p.ms, 3);
  }

  function formatAss(ms) {
    var totalCs = Math.round(Math.max(0, ms) / 10);
    var cs = totalCs % 100;
    var totalS = Math.floor(totalCs / 100);
    return Math.floor(totalS / 3600) + ':' +
      pad(Math.floor(totalS / 60) % 60, 2) + ':' +
      pad(totalS % 60, 2) + '.' + pad(cs, 2);
  }

  function formatClock(ms) {
    var p = msToParts(ms);
    return pad(p.h, 2) + ':' + pad(p.m, 2) + ':' + pad(p.s, 2);
  }

  function toMs(h, m, s, frac) {
    var f = (String(frac == null ? '0' : frac) + '000').slice(0, 3);
    return ((parseInt(h, 10) || 0) * 3600 +
      (parseInt(m, 10) || 0) * 60 +
      (parseInt(s, 10) || 0)) * 1000 + parseInt(f, 10);
  }

  var TIME_PART = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;

  function readTiming(line) {
    var arrow = line.indexOf('-->');
    if (arrow < 0) return null;
    var left = line.slice(0, arrow).match(TIME_PART);
    var right = line.slice(arrow + 3).match(TIME_PART);
    if (!left || !right) return null;
    return {
      start: toMs(left[1], left[2], left[3], left[4]),
      end: toMs(right[1], right[2], right[3], right[4])
    };
  }

  function normalizeText(text) {
    return String(text == null ? '' : text)
      .replace(/\uFEFF/g, '')
      .replace(/\r\n?/g, '\n');
  }

  /* ------------------------------------------------------------------ *
   * 解析
   * ------------------------------------------------------------------ */

  function detectFormat(source) {
    var text = normalizeText(source).replace(/^\s+/, '');
    var head = text.slice(0, 6000);
    if (/^WEBVTT(\s|$)/i.test(head)) return 'vtt';
    if (/^\[Script Info\]/im.test(head) || /^Dialogue\s*:/im.test(head)) return 'ass';
    if (/-->/.test(head)) return 'srt';
    return 'srt';
  }

  function parseSrt(source) {
    var lines = normalizeText(source).split('\n');
    var cues = [];
    var i = 0;
    while (i < lines.length) {
      var timing = readTiming(lines[i]);
      if (!timing) { i++; continue; }
      i++;
      var body = [];
      while (i < lines.length && lines[i].trim() !== '') {
        if (isCueBoundary(lines, i)) break;
        body.push(lines[i]);
        i++;
      }
      pushCue(cues, timing.start, timing.end, body.join('\n'));
    }
    return cues;
  }

  function isCueBoundary(lines, index) {
    if (readTiming(lines[index])) return true;
    if (!/^\d+$/.test(lines[index].trim())) return false;
    return index + 1 < lines.length && !!readTiming(lines[index + 1]);
  }

  function parseVtt(source) {
    var lines = normalizeText(source).split('\n');
    var cues = [];
    var i = 0;
    var skipBlock = false;
    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (/^WEBVTT/i.test(trimmed)) { i++; continue; }
      if (/^(NOTE|STYLE|REGION)(\s|$)/i.test(trimmed)) {
        skipBlock = true;
        i++;
        continue;
      }
      if (skipBlock) {
        if (trimmed === '') skipBlock = false;
        i++;
        continue;
      }

      var timing = readTiming(trimmed);
      if (!timing) { i++; continue; }

      i++;
      var body = [];
      while (i < lines.length && lines[i].trim() !== '') {
        if (isCueBoundary(lines, i)) break;
        body.push(lines[i]);
        i++;
      }
      pushCue(cues, timing.start, timing.end, body.join('\n'));
    }
    return cues;
  }

  function parseAss(source) {
    var lines = normalizeText(source).split('\n');
    var cues = [];
    var inEvents = false;
    var fields = null;

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var trimmed = raw.trim();

      if (/^\[.*\]$/.test(trimmed)) {
        inEvents = /^\[Events\]$/i.test(trimmed);
        if (!inEvents) fields = null;
        continue;
      }
      if (!inEvents) continue;

      if (/^Format\s*:/i.test(trimmed)) {
        fields = trimmed.slice(trimmed.indexOf(':') + 1)
          .split(',')
          .map(function (name) { return name.trim().toLowerCase(); });
        continue;
      }
      if (!/^Dialogue\s*:/i.test(trimmed)) continue;

      var body = trimmed.slice(trimmed.indexOf(':') + 1);
      var cols = splitAssFields(body, fields ? fields.length : 10);
      var count = fields ? fields.length : 10;

      var startIndex = fields ? fields.indexOf('start') : 1;
      var endIndex = fields ? fields.indexOf('end') : 2;
      var textIndex = fields ? fields.indexOf('text') : 9;

      if (startIndex < 0 || endIndex < 0 || textIndex < 0) continue;
      if (cols.length < count) continue;

      var start = parseAssTime(cols[startIndex]);
      var end = parseAssTime(cols[endIndex]);
      if (start == null || end == null) continue;

      pushCue(cues, start, end, assToPlain(cols[textIndex]));
    }
    return cues;
  }

  function splitAssFields(body, count) {
    var parts = [];
    var from = 0;
    for (var i = 0; i < count - 1; i++) {
      var comma = body.indexOf(',', from);
      if (comma < 0) break;
      parts.push(body.slice(from, comma));
      from = comma + 1;
    }
    parts.push(body.slice(from));
    return parts;
  }

  function parseAssTime(value) {
    var m = String(value).trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,2})$/);
    if (!m) return null;
    var cs = parseInt((m[4] + '0').slice(0, 2), 10);
    return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + cs * 10;
  }

  function assToPlain(text) {
    return String(text)
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/\r/g, '')
      .trim();
  }

  function pushCue(list, start, end, text) {
    if (!isFinite(start) || !isFinite(end)) return;
    var clean = String(text == null ? '' : text).replace(/\u00a0/g, ' ');
    clean = clean.replace(/\s+$/, '');
    list.push({ start: start, end: end, text: clean });
  }

  function parse(source, formatHint) {
    var text = normalizeText(source);
    var format = formatHint && formatHint !== 'auto' ? formatHint : detectFormat(text);
    var cues;
    if (format === 'vtt') cues = parseVtt(text);
    else if (format === 'ass') cues = parseAss(text);
    else cues = parseSrt(text);
    return {
      format: format,
      cues: cues,
      empty: cues.length === 0
    };
  }

  /* ------------------------------------------------------------------ *
   * 输出
   * ------------------------------------------------------------------ */

  function toSrt(cues) {
    var out = [];
    var index = 1;
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      if (!cue.text || !cue.text.trim()) continue;
      out.push(
        index++ + '\n' +
        formatSrt(cue.start) + ' --> ' + formatSrt(cue.end) + '\n' +
        cue.text.replace(/\r/g, '')
      );
    }
    return out.join('\n\n') + (out.length ? '\n' : '');
  }

  function toVtt(cues) {
    var out = ['WEBVTT', ''];
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      if (!cue.text || !cue.text.trim()) continue;
      out.push(
        formatVtt(cue.start) + ' --> ' + formatVtt(cue.end) + '\n' +
        cue.text.replace(/\r/g, '')
      );
      out.push('');
    }
    return out.join('\n');
  }

  var ASS_HEADER = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,40,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ].join('\n');

  function toAss(cues) {
    var rows = [ASS_HEADER];
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      if (!cue.text || !cue.text.trim()) continue;
      var text = cue.text
        .replace(/\{[^}]*\}/g, '')
        .replace(/\n/g, '\\N')
        .replace(/^\s+|\s+$/g, '');
      rows.push('Dialogue: 0,' + formatAss(cue.start) + ',' + formatAss(cue.end) + ',Default,,0,0,0,,' + text);
    }
    return rows.join('\n') + '\n';
  }

  function serialize(cues, format) {
    if (format === 'vtt') return toVtt(cues);
    if (format === 'ass') return toAss(cues);
    return toSrt(cues);
  }

  /* ------------------------------------------------------------------ *
   * 时间轴操作
   * ------------------------------------------------------------------ */

  function sortByTime(cues) {
    return cues.slice().sort(function (a, b) {
      return a.start - b.start || a.end - b.end;
    });
  }

  function shift(cues, offsetMs) {
    if (!offsetMs) return cues.slice();
    return cues.map(function (cue) {
      return { start: cue.start + offsetMs, end: cue.end + offsetMs, text: cue.text };
    });
  }

  function scale(cues, factor) {
    if (!factor || factor === 1) return cues.slice();
    return cues.map(function (cue) {
      return {
        start: Math.round(cue.start * factor),
        end: Math.round(cue.end * factor),
        text: cue.text
      };
    });
  }

  function trimToZero(cues, minDuration) {
    var floor = minDuration || 1;
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      if (cue.end <= 0) continue;
      var start = Math.max(0, cue.start);
      var end = Math.max(cue.end, start + floor);
      out.push({ start: start, end: end, text: cue.text });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 清洗
   * ------------------------------------------------------------------ */

  function stripTags(text) {
    return String(text)
      .replace(/<\/?[a-zA-Z][^>]{0,80}>/g, '')
      .replace(/\{\\[^}]{0,120}\}/g, '');
  }

  function tidyLines(text, collapseBlank, maxLines) {
    var lines = String(text).split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/[ \t]+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (!line && collapseBlank) continue;
      out.push(line);
    }
    while (out.length && !out[out.length - 1]) out.pop();
    while (out.length && !out[0]) out.shift();
    if (maxLines > 0 && out.length > maxLines) out = out.slice(0, maxLines);
    return out.join('\n');
  }

  var DEFAULT_CLEAN = {
    stripTags: true,
    tidyLines: true,
    collapseBlank: true,
    maxLines: 0,
    dropEmpty: true,
    fixInvalid: true,
    minDuration: 0,
    maxDuration: 0,
    mergeDuplicates: false,
    resolveOverlaps: false
  };

  function clean(cues, options) {
    var opts = {};
    for (var key in DEFAULT_CLEAN) opts[key] = DEFAULT_CLEAN[key];
    if (options) for (var k in options) if (options[k] !== undefined) opts[k] = options[k];

    var issues = [];
    var work = sortByTime(cues).map(function (cue) {
      var text = cue.text;
      if (opts.stripTags) text = stripTags(text);
      if (opts.tidyLines) text = tidyLines(text, opts.collapseBlank, opts.maxLines);

      var start = Math.round(cue.start);
      var end = Math.round(cue.end);

      if (end <= start) {
        if (!opts.fixInvalid) {
          issues.push({ level: 'warn', message: '有一条字幕的结束时间早于开始时间，已跳过：' + shortText(text) });
          return null;
        }
        end = start + (opts.minDuration > 0 ? opts.minDuration : 800);
        issues.push({ level: 'info', message: '修正了一条时长异常的显示区间：' + shortText(text) });
      }

      if (opts.minDuration > 0 && end - start < opts.minDuration) {
        end = start + opts.minDuration;
      }
      if (opts.maxDuration > 0 && end - start > opts.maxDuration) {
        end = start + opts.maxDuration;
      }
      if (opts.dropEmpty && !text.trim()) return null;

      return { start: start, end: end, text: text };
    }).filter(Boolean);

    if (opts.mergeDuplicates) work = mergeNeighbours(work, issues);
    if (opts.resolveOverlaps) work = cutOverlaps(work, issues);

    return { cues: work, issues: issues };
  }

  function mergeNeighbours(cues, issues) {
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var prev = out[out.length - 1];
      var sameText = prev && prev.text.trim() === cue.text.trim() && cue.text.trim() !== '';
      if (sameText && cue.start - prev.end <= 400) {
        prev.end = Math.max(prev.end, cue.end);
        issues.push({ level: 'info', message: '合并了一条重复字幕：' + shortText(cue.text) });
        continue;
      }
      out.push({ start: cue.start, end: cue.end, text: cue.text });
    }
    return out;
  }

  function cutOverlaps(cues, issues) {
    var changed = 0;
    for (var i = 1; i < cues.length; i++) {
      var prev = cues[i - 1];
      var cue = cues[i];
      if (cue.start < prev.end - 1) {
        var nextEnd = cue.start - 1;
        if (nextEnd > prev.start + 200) {
          prev.end = nextEnd;
          changed++;
        }
      }
    }
    if (changed) {
      issues.push({ level: 'info', message: '收紧了 ' + changed + ' 处时间重叠，避免相邻字幕同时停留在画面上。' });
    }
    return cues;
  }

  function shortText(text) {
    var flat = String(text).replace(/\s+/g, ' ').trim();
    return flat.length > 18 ? flat.slice(0, 18) + '…' : flat;
  }

  /* ------------------------------------------------------------------ *
   * 双语合并
   * ------------------------------------------------------------------ */

  function mergeBilingual(primary, secondary, options) {
    var opts = options || {};
    var secondaryFirst = !!opts.secondaryFirst;
    var ratio = opts.minOverlapRatio == null ? 0.15 : opts.minOverlapRatio;

    var matched = 0;
    var used = {};
    var cues = primary.map(function (main) {
      var best = null;
      var bestOverlap = 0;

      for (var j = 0; j < secondary.length; j++) {
        var sub = secondary[j];
        var overlap = Math.min(main.end, sub.end) - Math.max(main.start, sub.start);
        if (overlap <= 0) continue;
        var minDuration = Math.min(main.end - main.start, sub.end - sub.start) || 1;
        if (overlap / minDuration < ratio) continue;
        if (overlap > bestOverlap) { bestOverlap = overlap; best = sub; }
      }

      if (!best || !best.text.trim() || !main.text.trim()) {
        return { start: main.start, end: main.end, text: main.text };
      }

      matched++;
      used[best.start + ':' + best.end] = true;
      var text = secondaryFirst
        ? best.text + '\n' + main.text
        : main.text + '\n' + best.text;
      return { start: main.start, end: main.end, text: text };
    });

    return {
      cues: cues,
      matched: matched,
      unmatched: secondary.length - Object.keys(used).length
    };
  }

  /* ------------------------------------------------------------------ *
   * 质检
   * ------------------------------------------------------------------ */

  function charCount(text) {
    return String(text).replace(/<[^>]*>/g, '').replace(/\s/g, '').length;
  }

  function analyze(cues) {
    var stats = {
      count: cues.length,
      spanMs: 0,
      totalMs: 0,
      avgMs: 0,
      shortestMs: 0,
      longestGapMs: 0,
      gapAtMs: 0,
      maxCps: 0,
      cpsAtMs: 0,
      cpsText: '',
      slowCount: 0,
      overlapCount: 0,
      chars: 0
    };
    if (!cues.length) return stats;

    var sorted = sortByTime(cues);
    var first = sorted[0];
    var last = sorted[sorted.length - 1];
    stats.spanMs = Math.max(0, last.end - first.start);
    stats.shortestMs = Math.min.apply(null, sorted.map(function (c) { return c.end - c.start; }));

    var total = 0;
    var chars = 0;
    for (var i = 0; i < sorted.length; i++) {
      var cue = sorted[i];
      var duration = Math.max(1, cue.end - cue.start);
      total += duration;
      chars += charCount(cue.text);
      var cps = charCount(cue.text) / (duration / 1000);
      if (duration >= 200 && cps > stats.maxCps) {
        stats.maxCps = Math.round(cps * 10) / 10;
        stats.cpsAtMs = cue.start;
        stats.cpsText = shortText(cue.text);
      }
      if (cps > 20 && duration >= 200) stats.slowCount++;
      if (i > 0 && sorted[i].start < sorted[i - 1].end - 1) stats.overlapCount++;
      if (i > 0) {
        var gap = sorted[i].start - sorted[i - 1].end;
        if (gap > stats.longestGapMs) {
          stats.longestGapMs = gap;
          stats.gapAtMs = sorted[i - 1].end;
        }
      }
    }
    stats.totalMs = total;
    stats.avgMs = Math.round(total / sorted.length);
    stats.chars = chars;
    return stats;
  }

  /* ------------------------------------------------------------------ *
   * 流程编排
   * ------------------------------------------------------------------ */

  function run(input) {
    var opts = input || {};
    var result = {
      cues: [],
      issues: [],
      stats: analyze([]),
      sourceFormat: 'srt',
      matched: 0,
      unmatched: 0,
      error: ''
    };

    if (!opts.source || !String(opts.source).trim()) return result;

    var parsed = parse(opts.source, opts.sourceFormat || 'auto');
    result.sourceFormat = parsed.format;

    if (!parsed.cues.length) {
      result.error = '没有读到可识别的时间轴，请检查文件内容是否完整。';
      return result;
    }

    var cues = parsed.cues;

    if (opts.bilingualSource && String(opts.bilingualSource).trim()) {
      var second = parse(opts.bilingualSource, opts.bilingualFormat || 'auto');
      if (second.cues.length) {
        var merged = mergeBilingual(cues, second.cues, {
          secondaryFirst: !!opts.secondaryFirst,
          minOverlapRatio: opts.minOverlapRatio
        });
        cues = merged.cues;
        result.matched = merged.matched;
        result.unmatched = merged.unmatched;
        if (!merged.matched) {
          result.issues.push({ level: 'warn', message: '两条字幕的时间轴没有重叠，第二份内容未能合并。' });
        }
      } else {
        result.issues.push({ level: 'warn', message: '第二份字幕没有读到可识别的时间轴。' });
      }
    }

    cues = scale(cues, Number(opts.factor) || 1);
    cues = shift(cues, Number(opts.offsetMs) || 0);
    cues = trimToZero(cues, 1);

    var cleaned = clean(cues, opts.clean);
    result.cues = cleaned.cues;
    result.issues = result.issues.concat(cleaned.issues);
    result.stats = analyze(cleaned.cues);

    if (result.stats.slowCount > 0) {
      result.issues.push({
        level: 'warn',
        message: '有 ' + result.stats.slowCount + ' 条字幕的阅读速度超过每秒 20 字，观众可能来不及看完。'
      });
    }
    if (result.stats.overlapCount > 0 && !(opts.clean && opts.clean.resolveOverlaps)) {
      result.issues.push({
        level: 'info',
        message: '检测到 ' + result.stats.overlapCount + ' 处时间重叠，相邻字幕会同时出现。'
      });
    }
    return result;
  }

  return {
    FORMATS: FORMATS,
    DEFAULT_CLEAN: DEFAULT_CLEAN,
    detectFormat: detectFormat,
    parse: parse,
    parseSrt: parseSrt,
    parseVtt: parseVtt,
    parseAss: parseAss,
    serialize: serialize,
    toSrt: toSrt,
    toVtt: toVtt,
    toAss: toAss,
    formatSrt: formatSrt,
    formatVtt: formatVtt,
    formatAss: formatAss,
    formatClock: formatClock,
    shift: shift,
    scale: scale,
    sortByTime: sortByTime,
    clean: clean,
    mergeBilingual: mergeBilingual,
    analyze: analyze,
    run: run
  };
});
