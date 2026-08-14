/* ============================================================================
   core.js — 命名空間、widget 註冊表、seeded PRNG、SVG helper、開機
   ----------------------------------------------------------------------------
   ★ 一律 classic script，不可用 ESM ★
   file:// 是 opaque origin，<script type="module"> 會被直接擋掉。
   同理不可用 fetch()：所有資料都由 *.data.js 掛在 window 上。
   ============================================================================ */
/* eslint-env browser */
'use strict';

window.TW = window.TW || {};
(function (TW) {

  /* ---------------------------------------------------------- widget 註冊 -- */

  /* 用 ||：萬一 core.js 被重複載入，不要把已註冊的 widget 清掉。
     （曾經發生過：產生器的 $' 陷阱讓 shell 尾巴重複，core.js 被載入兩次，
     第二次把註冊表洗掉，整頁 widget 全掛。） */
  TW.widgets = TW.widgets || Object.create(null);

  /** 註冊一個 widget 型別。factory(root, cfg) 需回傳實作契約的物件。 */
  TW.define = function (name, factory) { TW.widgets[name] = factory; };

  /* ------------------------------------------------------------ 亂數種子 -- */

  /** 字串 → 32-bit 整數。讓 widget id 本身就能決定種子。 */
  TW.hash = function (str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };

  /**
   * 可重現的偽亂數（mulberry32）。
   * 為什麼不用 Math.random()：這樣「隨機」的題目在不同人、不同 session
   * 都會長得一模一樣，meeting 上可以說「看第 7 條 read」而大家看到同一條。
   */
  TW.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ------------------------------------------------------------ SVG 建構 -- */

  var NS = 'http://www.w3.org/2000/svg';

  TW.svg = function (tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  };

  TW.text = function (x, y, str, cls, parent) {
    var t = TW.svg('text', { x: x, y: y, 'class': cls || 'lbl' }, parent);
    t.textContent = str;
    return t;
  };

  /** 建立一張標準畫布：viewBox 一律 0 0 1000 H。
      title/desc 要用 aria-labelledby / aria-describedby 接上去才會被唸出來
      —— role="img" 但沒有名字的話，螢幕閱讀器只會說一句「圖片」。
      （手繪的 .svg 由 build.mjs 做同一件事。）
      widget 每次 render 都會重畫，所以 id 要帶序號，不能固定。 */
  var stageSeq = 0;

  TW.stage = function (host, h, opts) {
    opts = opts || {};
    host.textContent = '';
    var uid = 'tw-stage-' + (++stageSeq);
    var s = TW.svg('svg', {
      viewBox: '0 0 1000 ' + h,
      'class': 'dia-svg' + (opts.minWide === false ? '' : ' min-wide'),
      role: 'img'
    }, host);
    if (opts.title) {
      var t = TW.svg('title', { id: uid + '-t' }, s);
      t.textContent = opts.title;
      s.setAttribute('aria-labelledby', uid + '-t');
    }
    if (opts.desc) {
      var d = TW.svg('desc', { id: uid + '-d' }, s);
      d.textContent = opts.desc;
      s.setAttribute('aria-describedby', uid + '-d');
    }
    return s;
  };

  TW.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); };

  /* --------------------------------------------------------------- 訊息 -- */

  TW.msg = function (root, text, ok) {
    var o = root.querySelector('.widget__msg');
    if (!o) return;
    o.textContent = text || '';
    if (text === '' || ok === undefined) o.removeAttribute('data-ok');
    else o.setAttribute('data-ok', String(!!ok));
  };

  TW.fail = function (root, text) {
    var stage = root.querySelector('.widget__stage') || root;
    stage.innerHTML = '<p class="widget__err">' + text + '</p>';
    root.setAttribute('data-ready', 'err');
  };

  /* --------------------------------------------------------------- 開機 -- */

  TW.boot = function () {
    var nodes = document.querySelectorAll('[data-widget]');
    for (var i = 0; i < nodes.length; i++) bootOne(nodes[i]);
  };

  function bootOne(root) {
    var name = root.getAttribute('data-widget');
    var wid = root.getAttribute('data-wid') || name;
    var factory = TW.widgets[name];

    if (!factory) {
      TW.fail(root, '此互動元件尚未載入：<code>' + name + '</code>');
      return;
    }

    var cfg = {};
    try { cfg = JSON.parse(root.getAttribute('data-config') || '{}'); }
    catch (e) { console.warn('[widget] config 解析失敗', wid, e); }
    if (cfg.seed === undefined) cfg.seed = TW.hash(wid);

    var api;
    /* 每個 widget 各自隔離：一個壞掉不能把整頁拖下水。 */
    try {
      api = factory(root, cfg) || {};
      if (api.init) api.init();

      var saved = TW.progress ? TW.progress.widget(wid) : null;
      if (saved && saved.state && api.setState) {
        try { api.setState(saved.state); }
        catch (e2) { console.warn('[widget] 還原狀態失敗', wid, e2); }
      }
      if (api.render) api.render();
    } catch (e3) {
      console.error('[widget]', wid, e3);
      TW.fail(root, '互動元件載入失敗（<code>' + name + '</code>）。其餘頁面內容仍可使用。');
      return;
    }

    root.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!b || !root.contains(b)) return;
      var act = b.getAttribute('data-act');
      try {
        if (act === 'reset') {
          if (api.reset) api.reset();
          if (api.render) api.render();
          TW.msg(root, '');
          /* 存起來的作答也要丟掉，否則重新整理會把剛剛清掉的答案救回來 */
          if (TW.progress) TW.progress.clearWidgetState(wid);
        } else if (act === 'check') {
          var r = (api.check && api.check()) || { ok: false, message: '' };
          TW.msg(root, r.message, r.ok);
          if (TW.progress) {
            TW.progress.recordWidget(wid, {
              solved: !!r.ok,
              score: r.score,
              state: api.getState ? api.getState() : null
            });
          }
        }
      } catch (e4) { console.error('[widget]', wid, e4); }
    });

    root.setAttribute('data-ready', '1');
  }

  /* ------------------------------------------------- 頁首：主題 / 字級 -- */

  function initChrome() {
    var H = document.documentElement;

    var themeBtn = document.querySelector('[data-theme-btn]');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var cur = H.getAttribute('data-theme');
        var next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
        if (next) H.setAttribute('data-theme', next);
        else H.removeAttribute('data-theme');
        if (TW.progress) TW.progress.patch(function (s) {
          s.ui = s.ui || {}; s.ui.theme = next || 'auto';
        });
        themeBtn.setAttribute('title',
          next === 'dark' ? '深色' : next === 'light' ? '淺色' : '跟隨系統');
      });
    }

    var fsBtn = document.querySelector('[data-fs-btn]');
    if (fsBtn) {
      var order = ['', 'l', 'xl', 's'];
      fsBtn.addEventListener('click', function () {
        var cur = H.getAttribute('data-fs') || '';
        var next = order[(order.indexOf(cur) + 1) % order.length];
        if (next) H.setAttribute('data-fs', next);
        else H.removeAttribute('data-fs');
        if (TW.progress) TW.progress.patch(function (s) {
          s.ui = s.ui || {}; s.ui.fontScale = next || 'm';
        });
      });
    }
  }

  /* ----------------------------------------------------- 目錄捲動高亮 -- */

  function initToc() {
    var toc = document.querySelector('.toc--sticky');
    if (!toc || !('IntersectionObserver' in window)) return;
    var links = {};
    toc.querySelectorAll('a[href^="#"]').forEach(function (a) {
      links[a.getAttribute('href').slice(1)] = a;
    });
    var heads = document.querySelectorAll('h2[id], h3[id]');
    if (!heads.length) return;

    var seen = new Set();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) seen.add(en.target.id); else seen.delete(en.target.id);
      });
      var active = null;
      heads.forEach(function (h) { if (!active && seen.has(h.id)) active = h.id; });
      for (var k in links) links[k].removeAttribute('aria-current');
      if (active && links[active]) links[active].setAttribute('aria-current', 'true');
    }, { rootMargin: '-72px 0px -70% 0px' });

    heads.forEach(function (h) { io.observe(h); });
  }

  /* --------------------------------------------------------------- 啟動 -- */

  function start() {
    initChrome();
    initToc();
    TW.boot();
    if (TW.progress) TW.progress.markSeen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})(window.TW);
