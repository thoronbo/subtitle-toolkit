/*!
 * 字幕工坊 Subtitle Toolkit — 核心逻辑测试
 * Copyright (c) 2026 深维工坊工作室 Deep Dimension Workshop
 * Released under the MIT License.
 *
 * 运行：node test/core.test.js
 */
'use strict';

var assert = require('assert');
var core = require('../assets/js/subtitle-core.js');

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + err.message);
  }
}

function group(name) {
  console.log('\n' + name);
}

/* ------------------------------------------------------------------ */

group('格式识别');

test('识别 SRT', function () {
  assert.strictEqual(core.detectFormat('1\n00:00:01,000 --> 00:00:02,000\n你好\n'), 'srt');
});

test('识别 WebVTT', function () {
  assert.strictEqual(core.detectFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nhello\n'), 'vtt');
});

test('识别 ASS', function () {
  var ass = '[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n';
  assert.strictEqual(core.detectFormat(ass), 'ass');
});

group('SRT 解析');

test('基本结构与多行文本', function () {
  var src = '1\n00:00:01,000 --> 00:00:04,500\n第一行\n第二行\n\n2\n00:00:05,000 --> 00:00:07,000\n再见\n';
  var cues = core.parseSrt(src);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].start, 1000);
  assert.strictEqual(cues[0].end, 4500);
  assert.strictEqual(cues[0].text, '第一行\n第二行');
  assert.strictEqual(cues[1].text, '再见');
});

test('容忍 CRLF、BOM 与缺失序号', function () {
  var src = '\uFEFF00:00:00,500 --> 00:00:02,000\r\n甲\r\n\r\n00:00:03,000 --> 00:00:04,000\r\n乙\r\n';
  var cues = core.parseSrt(src);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].start, 500);
  assert.strictEqual(cues[0].end, 2000);
  assert.strictEqual(cues[1].text, '乙');
});

test('缺失空行时不会把下一条时间轴吞进正文', function () {
  var src = '1\n00:00:01,000 --> 00:00:02,000\n甲\n2\n00:00:03,000 --> 00:00:04,000\n乙\n';
  var cues = core.parseSrt(src);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].text, '甲');
});

test('毫秒位数不足时按百毫秒补齐', function () {
  var cues = core.parseSrt('1\n00:00:01,5 --> 00:00:02,25\n内容\n');
  assert.strictEqual(cues[0].start, 1500);
  assert.strictEqual(cues[0].end, 2250);
});

group('WebVTT 解析');

test('跳过文件头、NOTE 与 cue 标识', function () {
  var src = [
    'WEBVTT',
    '',
    'NOTE 这是一段注释',
    '不会出现在结果里',
    '',
    'cue-1',
    '00:01.000 --> 00:04.000 align:start',
    '第一句',
    '',
    '00:05.000 --> 00:06.000',
    '第二句'
  ].join('\n');
  var cues = core.parseVtt(src);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].start, 1000);
  assert.strictEqual(cues[0].text, '第一句');
  assert.strictEqual(cues[1].start, 5000);
});

test('支持带小时的写法', function () {
  var cues = core.parseVtt('WEBVTT\n\n01:02:03.400 --> 01:02:05.900\n内容\n');
  assert.strictEqual(cues[0].start, 3723400);
  assert.strictEqual(cues[0].end, 3725900);
});

group('ASS 解析');

test('按 Format 顺序取值，正文里的逗号不会截断', function () {
  var src = [
    '[Script Info]',
    'Title: demo',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,你好，世界\\N第二行'
  ].join('\n');
  var cues = core.parseAss(src);
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].start, 1000);
  assert.strictEqual(cues[0].end, 3500);
  assert.strictEqual(cues[0].text, '你好，世界\n第二行');
});

test('剔除花括号样式代码', function () {
  var src = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}斜体{\\i0}文本';
  var cues = core.parseAss(src);
  assert.strictEqual(cues[0].text, '斜体文本');
});

group('输出格式');

test('SRT 输出格式正确', function () {
  var out = core.toSrt([{ start: 1000, end: 2500, text: '你好' }]);
  assert.strictEqual(out, '1\n00:00:01,000 --> 00:00:02,500\n你好\n');
});

test('WebVTT 输出带文件头', function () {
  var out = core.toVtt([{ start: 1000, end: 2500, text: '你好' }]);
  assert.ok(out.indexOf('WEBVTT') === 0);
  assert.ok(out.indexOf('00:00:01.000 --> 00:00:02.500') > 0);
});

test('ASS 输出使用百分之一秒并转义换行', function () {
  var out = core.toAss([{ start: 1000, end: 2500, text: '上\n下' }]);
  assert.ok(out.indexOf('[Events]') > -1);
  assert.ok(out.indexOf('Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,上\\N下') > -1);
});

test('三种格式互转后时间保持一致', function () {
  var cues = [{ start: 3723400, end: 3725900, text: '内容' }];
  var srt = core.toSrt(cues);
  var vtt = core.toVtt(cues);
  var ass = core.toAss(cues);
  assert.strictEqual(core.parse(srt, 'srt').cues[0].start, 3723400);
  assert.strictEqual(core.parse(vtt, 'vtt').cues[0].start, 3723400);
  assert.strictEqual(core.parse(ass, 'ass').cues[0].start, 3723400);
});

group('时间轴调整');

test('整体偏移包含负值', function () {
  var cues = core.shift([{ start: 1000, end: 2000, text: 'a' }], -500);
  assert.strictEqual(cues[0].start, 500);
  assert.strictEqual(cues[0].end, 1500);
});

test('负偏移越界时丢弃已完全离开画面的条目', function () {
  var cues = core.shift([{ start: 100, end: 300, text: 'a' }, { start: 1000, end: 2000, text: 'b' }], -500);
  var kept = cues.filter(function (c) { return c.end > 0; });
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0].text, 'b');
});

test('按倍率缩放整条时间轴', function () {
  var cues = core.scale([{ start: 1000, end: 2000, text: 'a' }], 0.5);
  assert.strictEqual(cues[0].start, 500);
  assert.strictEqual(cues[0].end, 1000);
});

group('清洗');

test('去掉 HTML 标签与花括号代码', function () {
  var out = core.clean([{ start: 0, end: 1000, text: '<i>你好</i>{\\b1}世界' }]);
  assert.strictEqual(out.cues[0].text, '你好世界');
});

test('丢弃空字幕', function () {
  var out = core.clean([
    { start: 0, end: 1000, text: '   ' },
    { start: 1000, end: 2000, text: '有内容' }
  ]);
  assert.strictEqual(out.cues.length, 1);
});

test('修正结束时间早于开始时间的条目', function () {
  var out = core.clean([{ start: 5000, end: 3000, text: '异常' }], { minDuration: 600 });
  assert.strictEqual(out.cues[0].end - out.cues[0].start, 600);
  assert.ok(out.issues.length >= 1);
});

test('限制最长显示时长', function () {
  var out = core.clean([{ start: 0, end: 9000, text: '过长' }], { maxDuration: 7000 });
  assert.strictEqual(out.cues[0].end, 7000);
});

test('合并相邻重复字幕', function () {
  var out = core.clean([
    { start: 0, end: 1000, text: '同一句' },
    { start: 1100, end: 2000, text: '同一句' }
  ], { mergeDuplicates: true });
  assert.strictEqual(out.cues.length, 1);
  assert.strictEqual(out.cues[0].end, 2000);
});

test('收紧重叠区间', function () {
  var out = core.clean([
    { start: 0, end: 2000, text: '甲' },
    { start: 1500, end: 3000, text: '乙' }
  ], { resolveOverlaps: true });
  assert.strictEqual(out.cues[0].end, 1499);
});

test('限制每屏行数', function () {
  var out = core.clean([{ start: 0, end: 1000, text: '一\n二\n三' }], { maxLines: 2 });
  assert.strictEqual(out.cues[0].text, '一\n二');
});

group('双语合并');

test('按时间重叠把译文拼到原文下方', function () {
  var main = [
    { start: 0, end: 1000, text: 'Hello' },
    { start: 1000, end: 2000, text: 'World' }
  ];
  var sub = [
    { start: 0, end: 1000, text: '你好' },
    { start: 1000, end: 2000, text: '世界' }
  ];
  var out = core.mergeBilingual(main, sub);
  assert.strictEqual(out.matched, 2);
  assert.strictEqual(out.cues[0].text, 'Hello\n你好');
  assert.strictEqual(out.cues[1].text, 'World\n世界');
});

test('可以切换译文在上', function () {
  var out = core.mergeBilingual(
    [{ start: 0, end: 1000, text: 'Hello' }],
    [{ start: 0, end: 1000, text: '你好' }],
    { secondaryFirst: true }
  );
  assert.strictEqual(out.cues[0].text, '你好\nHello');
});

test('时间轴完全不重叠时不误合并', function () {
  var out = core.mergeBilingual(
    [{ start: 0, end: 1000, text: 'Hello' }],
    [{ start: 5000, end: 6000, text: '你好' }],
    {}
  );
  assert.strictEqual(out.matched, 0);
  assert.strictEqual(out.cues[0].text, 'Hello');
});

test('重叠过少时不误合并', function () {
  var out = core.mergeBilingual(
    [{ start: 0, end: 10000, text: 'Hello' }],
    [{ start: 9950, end: 12000, text: '你好' }],
    {}
  );
  assert.strictEqual(out.matched, 0);
});

group('质检');

test('统计条数、总时长与空档', function () {
  var stats = core.analyze([
    { start: 0, end: 1000, text: '甲' },
    { start: 4000, end: 6000, text: '乙' }
  ]);
  assert.strictEqual(stats.count, 2);
  assert.strictEqual(stats.totalMs, 3000);
  assert.strictEqual(stats.spanMs, 6000);
  assert.strictEqual(stats.longestGapMs, 3000);
  assert.strictEqual(stats.gapAtMs, 1000);
});

test('识别阅读速度过快的字幕', function () {
  var stats = core.analyze([
    { start: 0, end: 500, text: '这是一句非常非常长的字幕内容用来测试阅读速度' }
  ]);
  assert.strictEqual(stats.slowCount, 1);
  assert.ok(stats.maxCps > 20);
});

test('空字幕不会报错', function () {
  var stats = core.analyze([]);
  assert.strictEqual(stats.count, 0);
  assert.strictEqual(stats.totalMs, 0);
});

group('端到端');

test('从 SRT 到 ASS 的完整处理', function () {
  var src = '1\n00:00:01,000 --> 00:00:03,000\n<i>第一句</i>\n\n2\n00:00:04,000 --> 00:00:06,000\n第二句\n';
  var result = core.run({
    source: src,
    offsetMs: 1000,
    factor: 1,
    clean: {}
  });
  assert.strictEqual(result.error, '');
  assert.strictEqual(result.cues.length, 2);
  assert.strictEqual(result.cues[0].start, 2000);
  assert.strictEqual(result.cues[0].text, '第一句');
  var ass = core.serialize(result.cues, 'ass');
  assert.ok(ass.indexOf('0:00:02.00,0:00:04.00') > -1);
});

test('倍率与偏移同时使用时，偏移作用在最终时间轴上', function () {
  var result = core.run({
    source: '1\n00:00:10,000 --> 00:00:20,000\n内容\n',
    offsetMs: 1000,
    factor: 0.5,
    clean: {}
  });
  assert.strictEqual(result.cues[0].start, 6000);
  assert.strictEqual(result.cues[0].end, 11000);
});

test('无法识别的内容返回可读的错误', function () {
  var result = core.run({ source: '这只是一段普通文字，没有时间轴。' });
  assert.ok(result.error.length > 0);
  assert.strictEqual(result.cues.length, 0);
});

test('空输入不抛异常', function () {
  var result = core.run({ source: '' });
  assert.strictEqual(result.error, '');
  assert.strictEqual(result.cues.length, 0);
});

/* ------------------------------------------------------------------ */

console.log('\n' + passed + ' 通过，' + failed + ' 失败');
if (failed > 0) process.exitCode = 1;
