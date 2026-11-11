/*!
 * 字幕工坊 Subtitle Toolkit — 界面逻辑
 * Copyright (c) 2026 深维工坊工作室 Deep Dimension Workshop
 * Released under the MIT License.
 */
(function () {
  'use strict';

  var C = window.SubtitleCore;
  var byId = function (id) { return document.getElementById(id); };

  var el = {
    source: byId('source'),
    sourceFormat: byId('source-format'),
    fileInput: byId('file-input'),
    clearBtn: byId('clear-btn'),
    drop: byId('drop'),
    bilingual: byId('bilingual'),
    bilingualBox: byId('bilingual-box'),
    secondaryFirst: byId('secondary-first'),
    offset: byId('offset'),
    speed: byId('speed'),
    fpsPresets: byId('fps-presets'),
    optMerge: byId('opt-merge'),
    optOverlap: byId('opt-overlap'),
    optLines: byId('opt-lines'),
    optMin: byId('opt-min'),
    sourcePill: byId('source-pill'),
    fileNote: byId('file-note'),
    charNote: byId('char-note'),
    stats: byId('stats'),
    issues: byId('issues'),
    tabs: byId('format-tabs'),
    copyBtn: byId('copy-btn'),
    downloadBtn: byId('download-btn'),
    timeline: byId('timeline'),
    preview: byId('preview'),
    outputNote: byId('output-note'),
    actionNote: byId('action-note')
  };

  var state = {
    format: 'srt',
    fileName: '',
    cues: [],
    outputText: '',
    result: null,
    flashTimer: 0,
    renderTimer: 0
  };

  var MAX_PREVIEW = 20000;

  /* ---------------------------------------------------------------- 工具 */

  function pad(num, width) {
    var s = String(num);
    while (s.length < width) s = '0' + s;
    return s;
  }

  function formatLabel(format) {
    return format === 'vtt' ? 'WebVTT' : format.toUpperCase();
  }

  function formatClock(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2);
  }

  function formatSeconds(ms) {
    if (!ms) return '0.0 秒';
    return (ms / 1000).toFixed(1) + ' 秒';
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function byteLength(text) {
    try { return new Blob([text]).size; }
    catch (err) { return text.length; }
  }

  function countCps(cue) {
    var chars = String(cue.text).replace(/\s/g, '').length;
    var duration = Math.max(1, cue.end - cue.start);
    return chars / (duration / 1000);
  }

  function flash(message) {
    el.actionNote.textContent = message;
    window.clearTimeout(state.flashTimer);
    state.flashTimer = window.setTimeout(function () {
      el.actionNote.textContent = '';
    }, 2200);
  }

  function scheduleRender() {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(render, 160);
  }

  /* ---------------------------------------------------------------- 文件读取 */

  function decodeBytes(bytes) {
    if (bytes.length > 1) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (err) {
      try {
        return new TextDecoder('gbk').decode(bytes);
      } catch (err2) {
        return new TextDecoder('utf-8').decode(bytes);
      }
    }
  }

  function readText(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = '';
      try { text = decodeBytes(new Uint8Array(reader.result)); }
      catch (err) { text = ''; }
      done(text);
    };
    reader.onerror = function () { done(''); };
    reader.readAsArrayBuffer(file);
  }

  function applyFile(file, text, target) {
    if (!text) {
      flash('这个文件没能读出内容');
      return;
    }
    if (target === 'bilingual') {
      el.bilingual.value = text;
      el.bilingualBox.open = true;
      flash('已放入译文 ' + file.name);
    } else {
      el.source.value = text;
      el.sourceFormat.value = 'auto';
      state.fileName = file.name;
      el.fileNote.textContent = file.name + ' · ' + formatSize(byteLength(text));
      flash('已导入 ' + file.name);
    }
    render();
  }

  /* ---------------------------------------------------------------- 渲染 */

  function render() {
    var offset = parseInt(el.offset.value, 10);
    var factor = parseFloat(el.speed.value);

    var result = C.run({
      source: el.source.value,
      sourceFormat: el.sourceFormat.value,
      bilingualSource: el.bilingual.value,
      secondaryFirst: el.secondaryFirst.checked,
      offsetMs: isNaN(offset) ? 0 : offset,
      factor: isNaN(factor) || factor <= 0 ? 1 : factor,
      clean: {
        maxLines: Math.max(0, parseInt(el.optLines.value, 10) || 0),
        minDuration: Math.max(0, parseInt(el.optMin.value, 10) || 0),
        mergeDuplicates: el.optMerge.checked,
        resolveOverlaps: el.optOverlap.checked
      }
    });

    state.result = result;
    state.cues = result.cues;

    var hasContent = el.source.value.trim().length > 0;
    state.outputText = result.cues.length ? C.serialize(result.cues, state.format) : '';

    renderPill(result, hasContent);
    renderStats(result, hasContent);
    renderIssues(result, hasContent);
    renderPreview(result, hasContent);
    drawTimeline(result.cues);

    el.charNote.textContent = el.source.value.length.toLocaleString('zh-CN') + ' 字符';
    el.downloadBtn.disabled = !state.outputText;
  }

  function renderPill(result, hasContent) {
    if (!hasContent) {
      el.sourcePill.textContent = '等待导入';
      return;
    }
    if (result.error) {
      el.sourcePill.textContent = '无法识别';
      return;
    }
    el.sourcePill.textContent = formatLabel(result.sourceFormat) + ' · ' + result.cues.length + ' 条';
  }

  function statCell(label, value, tone) {
    var box = document.createElement('div');
    box.className = 'stat' + (tone ? ' is-' + tone : '');
    var b = document.createElement('b');
    b.textContent = value;
    var span = document.createElement('span');
    span.textContent = label;
    box.appendChild(b);
    box.appendChild(span);
    return box;
  }

  function renderStats(result, hasContent) {
    el.stats.innerHTML = '';
    var stats = result.stats;

    if (!hasContent || !result.cues.length) {
      el.stats.appendChild(statCell('字幕条数', '0'));
      el.stats.appendChild(statCell('总时长', '00:00:00'));
      el.stats.appendChild(statCell('平均停留', '—'));
      el.stats.appendChild(statCell('最长空档', '—'));
      el.stats.appendChild(statCell('最快语速', '—'));
      el.stats.appendChild(statCell('时间重叠', '—'));
      return;
    }

    el.stats.appendChild(statCell('字幕条数', String(stats.count)));
    el.stats.appendChild(statCell('总时长', formatClock(stats.spanMs)));
    el.stats.appendChild(statCell('平均停留', formatSeconds(stats.avgMs)));
    el.stats.appendChild(statCell(
      '最长空档',
      stats.longestGapMs > 0 ? formatSeconds(stats.longestGapMs) : '无空档'
    ));
    el.stats.appendChild(statCell(
      '最快语速',
      stats.maxCps > 0 ? stats.maxCps + ' 字/秒' : '—',
      stats.maxCps > 20 ? 'warn' : ''
    ));
    el.stats.appendChild(statCell(
      '时间重叠',
      stats.overlapCount > 0 ? stats.overlapCount + ' 处' : '无',
      stats.overlapCount > 0 ? 'danger' : ''
    ));
  }

  function renderIssues(result, hasContent) {
    el.issues.innerHTML = '';

    if (!hasContent) return;

    if (result.error) {
      appendIssue(result.error, 'error');
      return;
    }

    var shown = result.issues.slice(0, 6);
    for (var i = 0; i < shown.length; i++) {
      appendIssue(shown[i].message, shown[i].level);
    }
    if (result.issues.length > shown.length) {
      appendIssue('另有 ' + (result.issues.length - shown.length) + ' 条提示未展开。', 'info');
    }
    if (!result.issues.length) {
      appendIssue('没有发现明显问题，可以直接导出。', 'ok');
    }
  }

  function appendIssue(message, level) {
    var li = document.createElement('li');
    li.className = 'is-' + level;
    li.textContent = message;
    el.issues.appendChild(li);
  }

  function renderPreview(result, hasContent) {
    el.outputNote.classList.remove('is-error');

    if (!hasContent) {
      el.preview.textContent = '';
      el.outputNote.textContent = '等待导入';
      return;
    }
    if (result.error) {
      el.preview.textContent = '';
      el.outputNote.textContent = result.error;
      el.outputNote.classList.add('is-error');
      return;
    }
    if (!state.outputText) {
      el.preview.textContent = '';
      el.outputNote.textContent = '没有可导出的内容';
      return;
    }

    var text = state.outputText;
    var truncated = text.length > MAX_PREVIEW;
    el.preview.textContent = truncated ? text.slice(0, MAX_PREVIEW) : text;

    var note = formatLabel(state.format) + ' · ' + result.cues.length + ' 条 · ' + formatSize(byteLength(text));
    if (truncated) note += ' · 预览只显示开头部分';
    el.outputNote.textContent = note;
  }

  /* ---------------------------------------------------------------- 时间轴 */

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawTimeline(cues) {
    var canvas = el.timeline;
    if (!canvas) return;

    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;

    var width = rect.width;
    var height = 64;
    var dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var padX = 14;
    var usable = width - padX * 2;
    var baseY = height - 17;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, baseY);
    ctx.lineTo(width - padX, baseY);
    ctx.stroke();

    if (!cues || !cues.length || usable <= 0) return;

    var span = 0;
    for (var i = 0; i < cues.length; i++) {
      if (cues[i].end > span) span = cues[i].end;
    }
    if (span <= 0) return;

    var laneHeight = 8;
    var laneGap = 5;
    var top = 11;

    for (var j = 0; j < cues.length; j++) {
      var cue = cues[j];
      var x = padX + (cue.start / span) * usable;
      var w = Math.max(2.5, ((cue.end - cue.start) / span) * usable);
      var lane = j % 2;
      var y = top + lane * (laneHeight + laneGap);

      var hot = countCps(cue) > 20;
      ctx.fillStyle = hot ? 'rgba(221, 165, 63, 0.72)' : 'rgba(91, 156, 255, 0.62)';
      roundRect(ctx, x, y, w, laneHeight, 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(139, 150, 167, 0.85)';
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('00:00', padX, baseY + 4);

    var endLabel = formatClock(span);
    var endWidth = ctx.measureText(endLabel).width;
    ctx.fillText(endLabel, width - padX - endWidth, baseY + 4);

    if (usable > 220) {
      var midLabel = formatClock(span / 2);
      var midWidth = ctx.measureText(midLabel).width;
      ctx.fillStyle = 'rgba(100, 110, 125, 0.9)';
      ctx.fillText(midLabel, padX + usable / 2 - midWidth / 2, baseY + 4);
    }
  }

  /* ---------------------------------------------------------------- 动作 */

  function fileName() {
    var base = state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : '字幕';
    return base + '.' + state.format;
  }

  function download() {
    if (!state.outputText) return;
    var blob = new Blob([state.outputText], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    flash('已保存 ' + a.download);
  }

  function legacyCopy() {
    var box = document.createElement('textarea');
    box.value = state.outputText;
    box.style.position = 'fixed';
    box.style.top = '0';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(box);
    flash(ok ? '已复制到剪贴板' : '复制没有成功，请手动选择结果内容');
  }

  function copy() {
    if (!state.outputText) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.outputText).then(function () {
        flash('已复制到剪贴板');
      }, legacyCopy);
    } else {
      legacyCopy();
    }
  }

  function clearAll() {
    el.source.value = '';
    el.bilingual.value = '';
    el.offset.value = '0';
    el.speed.value = '1';
    el.sourceFormat.value = 'auto';
    state.fileName = '';
    el.fileNote.textContent = '尚未导入内容';
    render();
  }

  function switchFormat(format) {
    state.format = format;
    var buttons = el.tabs.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].getAttribute('data-format') === format;
      buttons[i].classList.toggle('active', active);
      buttons[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    render();
  }

  /* ---------------------------------------------------------------- 绑定 */

  el.source.addEventListener('input', scheduleRender);
  el.bilingual.addEventListener('input', scheduleRender);
  el.sourceFormat.addEventListener('change', scheduleRender);
  el.offset.addEventListener('input', scheduleRender);
  el.speed.addEventListener('input', scheduleRender);
  el.secondaryFirst.addEventListener('change', scheduleRender);
  el.optMerge.addEventListener('change', scheduleRender);
  el.optOverlap.addEventListener('change', scheduleRender);
  el.optLines.addEventListener('input', scheduleRender);
  el.optMin.addEventListener('input', scheduleRender);
  el.clearBtn.addEventListener('click', clearAll);
  el.copyBtn.addEventListener('click', copy);
  el.downloadBtn.addEventListener('click', download);

  el.fpsPresets.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-factor]');
    if (!btn) return;
    el.speed.value = btn.getAttribute('data-factor');
    render();
    flash('已应用 ' + btn.textContent + ' 的时间倍率');
  });

  el.tabs.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-format]');
    if (!btn) return;
    switchFormat(btn.getAttribute('data-format'));
  });

  el.fileInput.addEventListener('change', function () {
    var file = el.fileInput.files && el.fileInput.files[0];
    if (!file) return;
    readText(file, function (text) { applyFile(file, text, 'source'); });
    el.fileInput.value = '';
  });

  var shiftButtons = document.querySelectorAll('[data-shift]');
  for (var i = 0; i < shiftButtons.length; i++) {
    shiftButtons[i].addEventListener('click', function (event) {
      var delta = parseInt(event.currentTarget.getAttribute('data-shift'), 10) || 0;
      var current = parseInt(el.offset.value, 10);
      el.offset.value = String((isNaN(current) ? 0 : current) + delta);
      render();
    });
  }

  function bindDropZone(node, target) {
    var depth = 0;

    node.addEventListener('dragenter', function (event) {
      event.preventDefault();
      depth++;
      node.classList.add('is-over');
    });
    node.addEventListener('dragover', function (event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    node.addEventListener('dragleave', function (event) {
      event.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) node.classList.remove('is-over');
    });
    node.addEventListener('drop', function (event) {
      event.preventDefault();
      depth = 0;
      node.classList.remove('is-over');

      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) {
        readText(file, function (text) { applyFile(file, text, target); });
        return;
      }
      var text = event.dataTransfer && event.dataTransfer.getData('text/plain');
      if (text) {
        if (target === 'bilingual') {
          el.bilingual.value = text;
          el.bilingualBox.open = true;
        } else {
          el.source.value = text;
          el.fileNote.textContent = '已粘贴内容';
          state.fileName = '';
        }
        render();
      }
    });
  }

  bindDropZone(el.drop, 'source');
  bindDropZone(el.bilingual, 'bilingual');

  if (window.ResizeObserver) {
    new ResizeObserver(function () { drawTimeline(state.cues); }).observe(el.timeline);
  } else {
    window.addEventListener('resize', function () { drawTimeline(state.cues); });
  }

  render();
})();
