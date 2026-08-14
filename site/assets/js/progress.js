/* ============================================================================
   progress.js — localStorage 進度（schema v1）
   ----------------------------------------------------------------------------
   ★ file:// 的儲存陷阱，這整個檔案都是為了因應它 ★

   瀏覽器把 file:// 當成單一 opaque origin，因此：
     (a) 這台電腦上「所有」本機 HTML 共用同一個 localStorage bucket
         → key 必須 namespace，不然會跟其他本機檔案打架
     (b) 儲存綁在瀏覽器 profile，不是綁在教材檔案
         → 換電腦、換瀏覽器、或兩個學生共用一個帳號，資料就對不上
     (c) Safari 私密瀏覽下 setItem() 會直接丟 QuotaExceededError
         → 全部要包 try/catch，並降級成記憶體儲存

   所以「匯出／匯入進度」是第一級功能，不是附加功能。
   ============================================================================ */
/* eslint-env browser */
'use strict';

window.TW = window.TW || {};
(function (TW) {

  var KEY = 'ccu.lrcg.tutorial.v1';
  var SCHEMA = 1;

  var memory = null;      /* localStorage 不能用時的降級儲存 */
  var degraded = false;
  var writeTimer = null;

  function blank() {
    return { v: SCHEMA, updated: null, ui: {}, modules: {} };
  }

  function readRaw() {
    if (memory) return memory;
    try {
      var s = localStorage.getItem(KEY);
      if (!s) return blank();
      var o = JSON.parse(s);
      return migrate(o);
    } catch (e) {
      return blank();
    }
  }

  /* 之後改 schema 時從這裡接上去，不要直接洗掉學生的進度 */
  function migrate(o) {
    if (!o || typeof o !== 'object') return blank();
    if (!o.v) o.v = SCHEMA;
    o.ui = o.ui || {};
    o.modules = o.modules || {};
    return o;
  }

  /* 真正落地的那一步。debounce 與 flush 都走這裡。 */
  function commit() {
    if (!memory) return;
    clearTimeout(writeTimer);
    writeTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(memory));
      memory = null;                /* 寫成功就不必留記憶體副本 */
    } catch (e) {
      if (!degraded) { degraded = true; showDegradedBanner(); }
    }
  }

  function writeRaw(o) {
    o.updated = new Date().toISOString();
    memory = o;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(commit, 400);
  }

  /* ★ 一定要在離開頁面前同步寫完 ★
     瀏覽器在導覽時會直接丟掉還沒觸發的 setTimeout，所以只靠 400 ms 的
     debounce 等於「按下一頁就不存」。最會中招的是捲動深度：
     trackScroll 正好是在 visibilitychange 當下才呼叫 patch()，
     接著頁面就卸載了，那筆 scrollMax 從來沒有真的寫進 localStorage。

     pagehide / visibilitychange 兩個都要掛：
       · pagehide —— 導覽與關分頁，bfcache 也算（Safari 只有這個可靠）
       · visibilitychange → hidden —— 手機切到背景後可能不再回來 */
  window.addEventListener('pagehide', commit);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') commit();
  });

  function showDegradedBanner() {
    if (!document.body) return;
    var b = document.createElement('div');
    b.className = 'banner';
    b.innerHTML = '無法將進度寫入瀏覽器儲存（可能因使用私密瀏覽模式）；' +
                  '本次閱讀紀錄僅保留於目前分頁。' +
                  '<button type="button" class="btn btn--ghost">知道了</button>';
    b.querySelector('button').addEventListener('click', function () { b.remove(); });
    var main = document.getElementById('main') || document.body;
    main.insertBefore(b, main.firstChild);
  }

  /* 目前頁面的 module id：由檔名推得（m07.html → m07） */
  function currentModule() {
    var f = location.pathname.split('/').pop() || '';
    var m = /^([\w-]+)\.html$/.exec(f);
    if (!m) return null;
    var id = m[1];
    return (id === 'index' || id === 'glossary') ? null : id;
  }

  var P = {

    get: readRaw,

    patch: function (fn) {
      var s = readRaw();
      try { fn(s); } catch (e) { console.warn('[progress] patch 失敗', e); }
      writeRaw(s);
      return s;
    },

    module: function (id) {
      var s = readRaw();
      return s.modules[id] || null;
    },

    widget: function (wid) {
      var mid = wid.split('.')[0];
      var m = P.module(mid);
      return (m && m.widgets && m.widgets[wid]) || null;
    },

    markSeen: function () {
      var id = currentModule();
      if (!id) return;
      P.patch(function (s) {
        var m = s.modules[id] = s.modules[id] || {};
        m.firstSeen = m.firstSeen || Date.now();
        m.lastSeen = Date.now();
        m.visits = (m.visits || 0) + 1;
      });
      trackScroll(id);
    },

    recordWidget: function (wid, data) {
      var mid = wid.split('.')[0];
      P.patch(function (s) {
        var m = s.modules[mid] = s.modules[mid] || {};
        m.widgets = m.widgets || {};
        var w = m.widgets[wid] = m.widgets[wid] || { attempts: 0 };
        w.attempts++;
        w.solved = w.solved || !!data.solved;
        if (data.score !== undefined) w.score = data.score;
        if (data.state !== undefined && data.state !== null) w.state = data.state;
        w.at = Date.now();
      });
    },

    /** 「重來」用：只丟掉暫存的作答內容，不動 solved / attempts。
        不清的話，按了重來、重新整理，舊答案又會被 setState 還原回來 ——
        而 §9 說 reset 是「清使用者輸入」，不是「清掉學過的紀錄」。 */
    clearWidgetState: function (wid) {
      var mid = wid.split('.')[0];
      P.patch(function (s) {
        var m = s.modules[mid];
        if (m && m.widgets && m.widgets[wid]) delete m.widgets[wid].state;
      });
    },

    recordQuiz: function (qid, data) {
      var mid = qid.split('.')[0];
      P.patch(function (s) {
        var m = s.modules[mid] = s.modules[mid] || {};
        m.quiz = m.quiz || {};
        var q = m.quiz[qid] = m.quiz[qid] || { tries: 0 };
        q.tries++;
        q.picked = data.picked;
        q.correct = !!data.correct;
        q.at = Date.now();
      });
    },

    /** 完成度：0–1。測驗全對且所有 widget 都解出來才算 1。 */
    completion: function (id) {
      var m = P.module(id);
      if (!m) return 0;
      var parts = [];
      if (m.quiz) {
        var qs = Object.keys(m.quiz);
        if (qs.length) parts.push(qs.filter(function (k) { return m.quiz[k].correct; }).length / qs.length);
      }
      if (m.widgets) {
        var ws = Object.keys(m.widgets);
        if (ws.length) parts.push(ws.filter(function (k) { return m.widgets[k].solved; }).length / ws.length);
      }
      if (!parts.length) return m.scrollMax ? Math.min(1, m.scrollMax) * 0.6 : (m.lastSeen ? 0.15 : 0);
      var avg = parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
      return Math.max(avg, m.lastSeen ? 0.1 : 0);
    },

    lastModule: function () {
      var s = readRaw(), best = null, t = 0;
      for (var id in s.modules) {
        if (s.modules[id].lastSeen > t) { t = s.modules[id].lastSeen; best = id; }
      }
      return best;
    },

    /* ---- 匯出／匯入：在 file:// 下這是唯一可靠的跨機器帶著走的方式 ---- */

    exportText: function () { return JSON.stringify(readRaw(), null, 2); },

    download: function () {
      var blob = new Blob([P.exportText()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
                  String(d.getDate()).padStart(2, '0');
      a.href = url;
      a.download = 'lrcg-progress-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    importText: function (txt) {
      var o = JSON.parse(txt);
      if (!o || typeof o !== 'object') throw new Error('格式不正確');
      writeRaw(migrate(o));
      return true;
    },

    reset: function () {
      memory = null;
      try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
    }
  };

  /* 捲動深度：便宜的「讀到哪」訊號 */
  function trackScroll(id) {
    var max = 0, ticking = false;
    function sample() {
      var h = document.documentElement;
      var denom = h.scrollHeight - h.clientHeight;
      var r = denom > 0 ? (h.scrollTop / denom) : 1;
      if (r > max) max = r;
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(sample); }
    }, { passive: true });

    /* 只在離開頁面時寫一次，不要每次捲動都打 localStorage。
       patch() 之後一定要自己 commit()：這個 handler 是在頁面即將卸載時才跑的，
       留給 debounce 的 400 ms 根本不會到。 */
    function saveScroll() {
      if (max <= 0) return;
      P.patch(function (s) {
        var m = s.modules[id] = s.modules[id] || {};
        m.scrollMax = Math.max(m.scrollMax || 0, Math.round(max * 100) / 100);
      });
      commit();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveScroll();
    });
    window.addEventListener('pagehide', saveScroll);
  }

  TW.progress = P;

})(window.TW);
