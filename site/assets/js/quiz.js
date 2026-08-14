/* ============================================================================
   quiz.js — 測驗引擎
   ----------------------------------------------------------------------------
   題目資料來自 window.TW_QUIZ（由 build.mjs 產生的 quiz.data.js）。
   不用 fetch —— file:// 會擋。

   教學設計上最重要的欄位是每個選項的 why：
   只說「答錯了」對學習沒有任何幫助，必須說明「為什麼這個選項錯」。
   所以正確選項也要有 why。
   ============================================================================ */
/* eslint-env browser */
'use strict';

(function () {
  var TW = window.TW || {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(section) {
    var qid = section.getAttribute('data-quiz');
    var items = (window.TW_QUIZ || {})[qid];
    var host = section.querySelector('.quiz__items');
    if (!items || !items.length || !host) {
      section.style.display = 'none';
      return;
    }

    items.forEach(function (q, idx) {
      var wrap = document.createElement('div');
      wrap.className = 'quiz__item';
      wrap.setAttribute('data-qid', q.id);

      var multi = q.type === 'multi';
      var inputType = multi ? 'checkbox' : 'radio';
      var name = q.id;

      var html =
        '<p class="quiz__stem"><b>' + (idx + 1) + '.</b> ' + q.stem_html + '</p>' +
        '<ul class="quiz__choices">';

      q.choices.forEach(function (c) {
        html +=
          '<li><label class="quiz__choice" data-cid="' + esc(c.id) + '">' +
          '<input type="' + inputType + '" name="' + esc(name) + '" value="' + esc(c.id) + '">' +
          '<span><span class="quiz__ctext">' + c.html + '</span>' +
          '<span class="quiz__why">' + (c.why || '') + '</span></span>' +
          '</label></li>';
      });

      html +=
        '</ul>' +
        '<div class="quiz__actions">' +
        '<button type="button" class="btn" data-qact="check">提交答案</button>' +
        (q.hint_zh ? '<button type="button" class="btn btn--ghost" data-qact="hint">顯示提示</button>' : '') +
        /* 跟 widget 的 .widget__msg 一樣要能被朗讀出來 ——
           不然螢幕閱讀器的使用者按下「提交答案」之後完全沒有回饋。 */
        '<output class="quiz__msg" role="status" aria-live="polite"></output>' +
        '</div>' +
        (q.hint_zh ? '<p class="quiz__hint" hidden>提示：' + q.hint_zh + '</p>' : '') +
        (q.explain_html ? '<div class="quiz__explain">' + q.explain_html + '</div>' : '');

      wrap.innerHTML = html;
      host.appendChild(wrap);

      /* 還原先前作答 */
      var saved = TW.progress && TW.progress.module(qid.split('.')[0]);
      var prev = saved && saved.quiz && saved.quiz[q.id];
      if (prev && prev.picked && prev.picked.length) {
        /* 比對 value，不要把存下來的字串拼進 querySelector ——
           那是使用者可匯入的資料，含引號就會丟 SyntaxError。 */
        var inputs = wrap.querySelectorAll('input[type="' + inputType + '"]');
        for (var n = 0; n < inputs.length; n++) {
          if (prev.picked.indexOf(inputs[n].value) >= 0) inputs[n].checked = true;
        }
        grade(wrap, q);
      }

      wrap.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-qact]');
        if (!b) return;
        if (b.getAttribute('data-qact') === 'hint') {
          var h = wrap.querySelector('.quiz__hint');
          if (h) h.hidden = !h.hidden;
        } else {
          grade(wrap, q, true);
        }
      });
    });
  }

  function grade(wrap, q, record) {
    var picked = [];
    wrap.querySelectorAll('input:checked').forEach(function (i) { picked.push(i.value); });

    var msg = wrap.querySelector('.quiz__msg');
    if (!picked.length) {
      msg.textContent = '請至少選擇一個選項';
      msg.setAttribute('data-ok', 'false');
      return;
    }

    var correctIds = q.choices.filter(function (c) { return c.correct; })
                              .map(function (c) { return c.id; });
    var ok = picked.length === correctIds.length &&
             picked.every(function (p) { return correctIds.indexOf(p) >= 0; });

    /* 標記每個被選到的選項，並揭曉它的 why */
    wrap.querySelectorAll('.quiz__choice').forEach(function (lab) {
      var cid = lab.getAttribute('data-cid');
      var c = q.choices.filter(function (x) { return x.id === cid; })[0];
      lab.removeAttribute('data-state');
      if (picked.indexOf(cid) >= 0) {
        lab.setAttribute('data-state', c && c.correct ? 'correct' : 'incorrect');
      } else if (c && c.correct) {
        /* 沒選到的正解也要顯示，否則學生不知道正確答案是什麼 */
        lab.setAttribute('data-state', 'correct');
      }
    });

    msg.textContent = ok ? '✓ 正確' : '✗ 答案不正確；下方已標示正確選項與理由';
    msg.setAttribute('data-ok', String(ok));
    wrap.setAttribute('data-answered', '1');

    if (record && TW.progress) {
      TW.progress.recordQuiz(q.id, { picked: picked, correct: ok });
    }
  }

  /* 每個測驗區塊各自隔離 —— 跟 widget 同一個原則（core.js 的 bootOne）。
     沒有這層 try/catch 的話，只要有一筆存壞的作答（例如選項 id 裡混進
     引號，querySelector 會直接丟 SyntaxError），整頁後面的測驗就全部
     不會渲染，而學生只會看到幾個空白的「學習檢核」。 */
  function start() {
    var sections = document.querySelectorAll('.quiz[data-quiz]');
    for (var i = 0; i < sections.length; i++) {
      try {
        render(sections[i]);
      } catch (e) {
        console.error('[quiz]', sections[i].getAttribute('data-quiz'), e);
        var host = sections[i].querySelector('.quiz__items');
        if (host) {
          host.innerHTML = '<p class="widget__err">這一組測驗載入失敗。' +
            '其餘頁面內容仍可使用；點「匯出進度」備份後重設進度即可恢復。</p>';
        }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }

})();
