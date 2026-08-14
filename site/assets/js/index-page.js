/* ============================================================================
   index-page.js — 首頁：進度環、繼續上次、匯出／匯入
   ============================================================================ */
/* eslint-env browser */
'use strict';

(function () {
  var TW = window.TW || {};
  var P = TW.progress;
  var MODS = window.TW_MODULES || [];

  /* 顏色走 class（.ring__track / .ring__arc / .ring__tick，見 layout.css），
     跟全專案「顏色只用 class，不寫死」一致。
     （原本寫成 stroke="var(--accent)"，那樣其實也會正確上色 ——
     presentation attribute 裡的 var() 是會被代換的。改成 class 只是
     為了統一，不是修 bug。） */
  function ring(pct) {
    var r = 9, c = 2 * Math.PI * r;
    return '<svg class="ring" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
      '<circle class="ring__track" cx="12" cy="12" r="' + r + '"/>' +
      (pct > 0
        ? '<circle class="ring__arc" cx="12" cy="12" r="' + r + '" ' +
          'stroke-dasharray="' + (c * pct).toFixed(2) + ' ' + c.toFixed(2) + '" ' +
          'transform="rotate(-90 12 12)"/>'
        : '') +
      (pct >= 0.999
        ? '<path class="ring__tick" d="M8 12.5l2.6 2.6L16 9.7"/>'
        : '') +
      '</svg>';
  }

  function paint() {
    if (!P) return;
    var done = 0, started = 0;

    MODS.forEach(function (m) {
      var pct = P.completion(m.id);
      if (pct >= 0.999) done++;
      else if (pct > 0) started++;

      var host = document.querySelector('.mcard[data-mod="' + m.id + '"] [data-state]');
      if (host) {
        host.innerHTML = ring(pct);
        host.setAttribute('aria-hidden', 'false');
        host.setAttribute('role', 'img');
        host.setAttribute('aria-label',
          pct >= 0.999 ? '已完成' : pct > 0 ? '進行中 ' + Math.round(pct * 100) + '%' : '未開始');
      }
    });

    var sum = document.querySelector('[data-progress-summary]');
    if (sum) {
      sum.textContent = MODS.length
        ? '完成 ' + done + ' / ' + MODS.length + (started ? '，進行中 ' + started : '')
        : '—';
    }

    var last = P.lastModule();
    var resume = document.querySelector('[data-resume]');
    if (resume && last) {
      var m = MODS.filter(function (x) { return x.id === last; })[0];
      if (m) {
        resume.hidden = false;
        resume.setAttribute('href', last + '.html');
        resume.textContent = '繼續：' + (m.short || m.title_zh);
      }
    }
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    if (e.target.closest('[data-export-progress]')) {
      P.download();
      return;
    }

    if (e.target.closest('[data-import-progress]')) {
      showImport();
      return;
    }
  });

  function showImport() {
    var old = document.querySelector('.import-panel');
    if (old) { old.remove(); return; }

    var box = document.createElement('div');
    box.className = 'import-panel note';
    box.innerHTML =
      '<p><b>匯入進度</b>　貼上先前匯出的 JSON 內容或選取檔案，再選擇「匯入」。</p>' +
      '<p><input type="file" accept="application/json,.json" data-imp-file></p>' +
      '<textarea data-imp-text rows="5" style="width:100%;font-family:var(--font-mono);' +
      'font-size:.78rem;border:1px solid var(--rule);border-radius:6px;padding:.5em;' +
      'background:var(--paper);color:var(--ink)" placeholder="{ &quot;v&quot;: 1, ... }"></textarea>' +
      '<p><button type="button" class="btn" data-imp-go>匯入</button> ' +
      '<button type="button" class="btn btn--ghost" data-imp-cancel>取消</button> ' +
      '<span data-imp-msg style="font-size:.85rem;font-weight:600"></span></p>';

    var head = document.querySelector('.mhead');
    head.parentNode.insertBefore(box, head.nextSibling);

    var ta = box.querySelector('[data-imp-text]');
    var msg = box.querySelector('[data-imp-msg]');

    box.querySelector('[data-imp-file]').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { ta.value = fr.result; };
      fr.readAsText(f);
    });

    box.querySelector('[data-imp-cancel]').addEventListener('click', function () { box.remove(); });

    box.querySelector('[data-imp-go]').addEventListener('click', function () {
      try {
        P.importText(ta.value);
        msg.textContent = '✓ 已匯入';
        msg.style.color = 'var(--ok)';
        setTimeout(function () { box.remove(); paint(); }, 700);
      } catch (err) {
        msg.textContent = '✗ 匯入失敗：' + err.message;
        msg.style.color = 'var(--bad)';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint);
  } else { paint(); }

})();
