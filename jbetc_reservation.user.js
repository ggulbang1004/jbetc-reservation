// ==UserScript==
// @name         교직원수련원 선착순 예약 도우미
// @namespace    https://github.com/ggulbang1004/jbetc-reservation
// @version      1.0.0
// @description  전북특별자치도교육청교직원수련원 선착순 예약: 빈 객실이 있으면 우선순위에 따라 자동 예약
// @match        https://office.jbedu.kr/jbetc/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ggulbang1004/jbetc-reservation/main/jbetc_reservation.user.js
// @downloadURL  https://raw.githubusercontent.com/ggulbang1004/jbetc-reservation/main/jbetc_reservation.user.js
// ==/UserScript==

(function () {
  'use strict';

  var RESERVE_URL = 'https://office.jbedu.kr/jbetc/MABAEAB/index.do';
  var SKEY = 'jbetc_bot_state_v1';
  var CKEY = 'jbetc_bot_cfg_v1';

  // ------------------------------------------------------------ state/cfg --
  function loadState() {
    try { return JSON.parse(sessionStorage.getItem(SKEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveState(s) { sessionStorage.setItem(SKEY, JSON.stringify(s)); }
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CKEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveCfg(c) { localStorage.setItem(CKEY, JSON.stringify(c)); }

  var state = Object.assign(
    { running: false, paused: false, step: 'scan', attempts: 0, deadline: 0 },
    loadState());

  var cfg = Object.assign({
    date: '', nights: 1, guests: 2, building: 'alt', mode: 'priority',
    priorities: '6인실\n2인실', interval: 1.5, maxMinutes: 30, dryRun: true
  }, loadCfg());
  if (!cfg.date) {
    var d = new Date(Date.now() + 30 * 864e5);
    cfg.date = d.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------- panel --
  var panel, statusEl, logEl, clockEl;
  var inputs = {};

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function buildPanel() {
    if (document.getElementById('jbetc-bot-panel')) return;
    panel = el('div', { id: 'jbetc-bot-panel' });
    panel.style.cssText =
      'position:fixed;top:12px;right:12px;width:308px;z-index:2147483647;' +
      'background:#fff;border:1px solid #888;border-radius:10px;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.25);padding:10px 12px;' +
      'font-family:"Malgun Gothic",sans-serif;font-size:13px;color:#222;';
    panel.innerHTML =
      '<div style="font-weight:bold;font-size:14px;margin-bottom:6px;">' +
      '🏠 수련원 선착순 예약 도우미</div>' +

      '<div style="margin:4px 0;">이용 날짜 ' +
      '<input type="date" id="jb-date" style="width:130px;"> ' +
      '숙박 <input type="number" id="jb-nights" min="1" max="2" ' +
      'style="width:38px;">박 성인 <input type="number" id="jb-guests" ' +
      'min="1" max="6" style="width:38px;">명</div>' +

      '<fieldset style="border:1px solid #ccc;margin:6px 0;padding:4px 8px;">' +
      '<legend>건물 선택</legend>' +
      '<label><input type="radio" name="jb-b" value="main"> 본관만</label> ' +
      '<label><input type="radio" name="jb-b" value="annex"> 별관만</label> ' +
      '<label><input type="radio" name="jb-b" value="alt"> 본관 ↔ 별관 교대</label>' +
      '</fieldset>' +

      '<fieldset style="border:1px solid #ccc;margin:6px 0;padding:4px 8px;">' +
      '<legend>예약 방식</legend>' +
      '<label><input type="radio" name="jb-m" value="priority"> 🎯 우선순위 예약</label> ' +
      '<label><input type="radio" name="jb-m" value="any"> ⚡ 아무 방이나 예약</label>' +
      '<div style="margin-top:4px;">우선순위 (한 줄에 하나, 객실명에 들어가는 말)' +
      '<textarea id="jb-pri" rows="3" style="width:100%;box-sizing:border-box;">' +
      '</textarea></div></fieldset>' +

      '<div style="margin:4px 0;">새로고침 간격 ' +
      '<input type="number" id="jb-int" step="0.5" min="0.5" ' +
      'style="width:48px;">초 · 최대 ' +
      '<input type="number" id="jb-max" min="1" style="width:44px;">분 ' +
      '<label><input type="checkbox" id="jb-dry"> 연습 모드</label></div>' +

      '<div style="margin:6px 0;">' +
      '<button id="jb-start" style="margin-right:4px;">▶ 시작(새 세션)</button>' +
      '<button id="jb-pause" style="margin-right:4px;">⏸ 일시정지</button>' +
      '<button id="jb-restart" style="margin-right:4px;">↻ 다시시작(새 세션)</button>' +
      '<button id="jb-stop">⏹ 종료</button></div>' +

      '<div id="jb-status" style="font-weight:bold;margin:4px 0;">⏳ 대기 중…</div>' +
      '<div id="jb-clock" style="font-size:15px;">🕐 --:--:--</div>' +
      '<div id="jb-log" style="height:110px;overflow-y:auto;border-top:1px solid #ddd;' +
      'margin-top:6px;padding-top:4px;font-size:11px;line-height:1.5;color:#444;"></div>';
    document.body.appendChild(panel);

    statusEl = panel.querySelector('#jb-status');
    logEl = panel.querySelector('#jb-log');
    clockEl = panel.querySelector('#jb-clock');
    inputs.date = panel.querySelector('#jb-date');
    inputs.nights = panel.querySelector('#jb-nights');
    inputs.guests = panel.querySelector('#jb-guests');
    inputs.pri = panel.querySelector('#jb-pri');
    inputs.interval = panel.querySelector('#jb-int');
    inputs.max = panel.querySelector('#jb-max');
    inputs.dry = panel.querySelector('#jb-dry');

    inputs.date.value = cfg.date;
    inputs.nights.value = cfg.nights;
    inputs.guests.value = cfg.guests;
    inputs.pri.value = cfg.priorities;
    inputs.interval.value = cfg.interval;
    inputs.max.value = cfg.maxMinutes;
    inputs.dry.checked = !!cfg.dryRun;
    panel.querySelector('input[name="jb-b"][value="' + cfg.building + '"]').checked = true;
    panel.querySelector('input[name="jb-m"][value="' + cfg.mode + '"]').checked = true;

    panel.querySelector('#jb-start').addEventListener('click', startFresh);
    panel.querySelector('#jb-pause').addEventListener('click', togglePause);
    panel.querySelector('#jb-restart').addEventListener('click', restartFresh);
    panel.querySelector('#jb-stop').addEventListener('click', stopAll);

    setInterval(function () {
      clockEl.textContent = '🕐 ' + new Date().toLocaleTimeString('ko-KR',
        { hour12: false });
    }, 250);
    refreshStatus();
  }

  function readCfgFromPanel() {
    cfg.date = inputs.date.value || cfg.date;
    cfg.nights = Math.max(1, parseInt(inputs.nights.value, 10) || 1);
    cfg.guests = Math.max(1, parseInt(inputs.guests.value, 10) || 1);
    cfg.priorities = inputs.pri.value;
    cfg.interval = Math.max(0.5, parseFloat(inputs.interval.value) || 1.5);
    cfg.maxMinutes = Math.max(1, parseInt(inputs.max.value, 10) || 30);
    cfg.dryRun = inputs.dry.checked;
    var b = panel.querySelector('input[name="jb-b"]:checked');
    var m = panel.querySelector('input[name="jb-m"]:checked');
    if (b) cfg.building = b.value;
    if (m) cfg.mode = m.value;
    saveCfg(cfg);
  }

  function priorityList() {
    return cfg.priorities.split('\n').map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  // ------------------------------------------------------------- logging --
  function log(msg) {
    if (!logEl) return;
    var line = document.createElement('div');
    line.textContent = '[' + new Date().toLocaleTimeString('ko-KR',
      { hour12: false }) + '] ' + msg;
    logEl.appendChild(line);
    while (logEl.children.length > 120) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function refreshStatus(txt) {
    if (!statusEl) return;
    if (txt) { statusEl.textContent = txt; return; }
    if (!state.running) statusEl.textContent = '⏳ 대기 중…';
    else if (state.paused) statusEl.textContent = '⏸ 일시정지 중…';
    else statusEl.textContent = '🔍 빈 객실 찾는 중… (시도 ' +
      (state.attempts + 1) + '회)';
  }

  // ---------------------------------------------------------- DOM helpers --
  function visible(e) {
    return !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) &&
      !e.disabled;
  }
  function clickables(text) {
    var out = [];
    var nodes = document.querySelectorAll('button, a, input[type="button"], ' +
      'input[type="submit"], input[type="image"]');
    for (var i = 0; i < nodes.length; i++) {
      var e = nodes[i];
      var t = (e.tagName === 'INPUT' ? (e.value || '') : (e.textContent || ''))
        .replace(/\s+/g, ' ').trim();
      if (visible(e) && t.indexOf(text) !== -1) out.push(e);
    }
    return out;
  }
  function rowText(e) {
    var row = e.closest ? (e.closest('tr') || e.closest('li')) : null;
    if (row && row.innerText) return row.innerText.replace(/\s+/g, ' ').trim();
    var n = e, txt = '';
    for (var i = 0; i < 5 && n; i++) { n = n.parentElement; if (n) txt = n.innerText || ''; }
    return txt.replace(/\s+/g, ' ').trim();
  }
  function buildingOf(text) {
    if (text.indexOf('별관') !== -1) return 'annex';
    if (text.indexOf('본관') !== -1) return 'main';
    return null;
  }
  function setSelectWhere(optionPred, wantPred, label) {
    var sels = document.querySelectorAll('select');
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i];
      if (!visible(s)) continue;
      var opts = Array.prototype.map.call(s.options, function (o) {
        return o.text.replace(/\s+/g, ' ').trim();
      });
      if (!opts.some(optionPred)) continue;
      for (var j = 0; j < s.options.length; j++) {
        var t = s.options[j].text.replace(/\s+/g, ' ').trim();
        if (wantPred(t)) {
          if (s.selectedIndex !== j) {
            s.selectedIndex = j;
            s.dispatchEvent(new Event('change', { bubbles: true }));
            log(label + ' 선택: ' + t);
          }
          return true;
        }
      }
    }
    return false;
  }
  function blockText(e, up) {
    var n = e;
    for (var i = 0; i < (up || 6) && n; i++) n = n.parentElement;
    return n ? (n.innerText || '') : '';
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // -------------------------------------------------------------- engine --
  function handleAgreement() {
    var page = document.body ? document.body.innerText : '';
    if (page.indexOf('동의') === -1 && page.indexOf('약관') === -1) return;
    var boxes = document.querySelectorAll('input[type="checkbox"]');
    var changed = false;
    boxes.forEach(function (b) {
      if (visible(b) && !b.checked) { b.click(); changed = true; }
    });
    if (changed) log('약관 동의 체크 완료');
  }

  function setDate() {
    if (!cfg.date) return;
    var target = new Date(cfg.date + 'T00:00:00');
    var ymd = cfg.date, dot = cfg.date.replace(/-/g, '.');
    var inps = document.querySelectorAll('input[type="text"], input[type="date"]');
    for (var i = 0; i < inps.length; i++) {
      var e = inps[i];
      if (!visible(e)) continue;
      var hint = (e.id + ' ' + e.name + ' ' + (e.placeholder || '')).toLowerCase();
      var v = e.value || '';
      if (hint.indexOf('date') !== -1 || /^\d{4}[-.]/.test(v) ||
          hint.indexOf('날짜') !== -1) {
        if (v.replace(/\./g, '-') !== ymd) {
          e.removeAttribute('readonly');
          e.value = ymd;
          e.dispatchEvent(new Event('change', { bubbles: true }));
          e.dispatchEvent(new Event('blur', { bubbles: true }));
          log('날짜 입력: ' + dot);
        }
        return;
      }
    }
    // 달력 셀 클릭 (일 숫자)
    var cells = document.querySelectorAll('td, a, button, span');
    for (var j = 0; j < cells.length; j++) {
      var c = cells[j];
      if (visible(c) && (c.textContent || '').trim() === String(target.getDate())) {
        var around = blockText(c, 8);
        if (around.indexOf('월') !== -1 || around.length < 800) {
          c.click();
          log('달력에서 ' + target.getDate() + '일 선택');
          return;
        }
      }
    }
  }

  function isDetailPage() {
    var t = document.body ? document.body.innerText : '';
    return t.indexOf('총금액') !== -1 && t.indexOf('조식') !== -1;
  }
  function isSuccessPage() {
    var t = document.body ? document.body.innerText : '';
    return t.indexOf('예약이 완료') !== -1 || t.indexOf('예약완료') !== -1 ||
      (t.indexOf('예약번호') !== -1 && t.indexOf('내 예약조회') !== -1);
  }

  function wantedBuildingKw() {
    if (cfg.building === 'main') return '본관';
    if (cfg.building === 'annex') return '별관';
    return state.attempts % 2 === 0 ? '본관' : '별관'; // 교대
  }

  function applyConditions() {
    setSelectWhere(
      function (t) { return t.indexOf('박') !== -1; },
      function (t) { return t.indexOf(cfg.nights + '박') !== -1; },
      '숙박일수');
    var kw = wantedBuildingKw();
    setSelectWhere(
      function (t) { return t === '본관' || t === '별관' || t.indexOf('본관') !== -1 || t.indexOf('별관') !== -1; },
      function (t) { return t.indexOf(kw) !== -1; },
      '객실유형(' + kw + ')');
    setDate();
  }

  async function scanStep() {
    handleAgreement();
    applyConditions();
    var search = clickables('조회')[0] || clickables('검색')[0];
    if (search) { search.click(); await sleep(1000); }
    if (!state.running || state.paused) return;

    var btns = clickables('예약하기').filter(function (b) {
      return (b.textContent || b.value || '').replace(/\s+/g, '')
        .indexOf('예약하기') !== -1;
    });
    if (!btns.length) { scheduleNext(); return; }

    var cands = btns.map(function (b) { return { btn: b, text: rowText(b) }; });
    // 건물 필터
    if (cfg.building === 'main')
      cands = cands.filter(function (c) { return buildingOf(c.text) !== 'annex'; });
    else if (cfg.building === 'annex')
      cands = cands.filter(function (c) { return buildingOf(c.text) !== 'main'; });
    else {
      var want = state.attempts % 2 === 0 ? 'main' : 'annex';
      var pref = cands.filter(function (c) { return buildingOf(c.text) === want; });
      if (pref.length) cands = pref;
    }
    if (!cands.length) { scheduleNext(); return; }

    var pick = null;
    if (cfg.mode === 'priority') {
      var pris = priorityList();
      for (var i = 0; i < pris.length && !pick; i++) {
        for (var j = 0; j < cands.length; j++) {
          if (cands[j].text.indexOf(pris[i]) !== -1) { pick = cands[j]; break; }
        }
      }
      if (!pick) { scheduleNext(); return; }
    } else {
      pick = cands[0];
    }

    log('객실 발견: ' + pick.text.slice(0, 50) + ' → 예약하기 클릭');
    state.step = 'detail';
    saveState(state);
    pick.btn.click();
    // 같은 화면에서 상세 영역이 뜨는 경우까지 대비해 잠시 기다렸다 확인
    await sleep(1200);
    if (isDetailPage()) detailStep();
    // 화면이 바뀌면(새 페이지 로드) 스크립트가 다시 실행되며 detail 단계로 이어감
  }

  async function detailStep() {
    // 숙박인원 설정 — '조식' 영역의 select는 건드리지 않음 (조식은 0명 유지)
    var sels = document.querySelectorAll('select');
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i];
      if (!visible(s)) continue;
      if (blockText(s, 6).indexOf('조식') !== -1) continue;
      var hasPersons = Array.prototype.some.call(s.options, function (o) {
        return o.text.indexOf('명') !== -1;
      });
      if (!hasPersons) continue;
      for (var j = 0; j < s.options.length; j++) {
        var t = s.options[j].text.replace(/\s+/g, '').trim();
        if (t.indexOf(cfg.guests + '명') === 0) {
          if (s.selectedIndex !== j) {
            s.selectedIndex = j;
            s.dispatchEvent(new Event('change', { bubbles: true }));
            log('숙박인원 선택: ' + s.options[j].text);
          }
          break;
        }
      }
      break; // 숙박인원(성인) 첫 번째 select만
    }
    await sleep(200);

    var btns = clickables('예약하기');
    if (!btns.length) {
      log('상세 화면에서 예약하기 버튼을 찾지 못했습니다. 목록으로 돌아갑니다.');
      state.step = 'scan'; saveState(state);
      location.href = RESERVE_URL;
      return;
    }
    var submit = btns[btns.length - 1];
    if (cfg.dryRun) {
      submit.style.outline = '4px solid red';
      submit.scrollIntoView({ block: 'center' });
      state.running = false; state.step = 'scan'; saveState(state);
      refreshStatus('🧪 연습 모드: 마지막 예약하기 직전에서 멈췄습니다');
      log('연습 모드 — 실제 예약을 하지 않았습니다. 버튼 위치를 확인해 주세요.');
      return;
    }
    state.step = 'verify'; saveState(state);
    log('최종 예약하기 클릭!');
    submit.click();
    await sleep(1500);
    if (isSuccessPage()) return done();
    if (!isDetailPage()) return; // 페이지가 바뀌면 로드 후 verify 단계에서 확인
    // 여전히 상세 화면이면 오류로 보고 재시도
    log('예약이 완료되지 않은 것 같습니다. 목록으로 돌아가 재시도합니다.');
    state.step = 'scan'; saveState(state);
    location.href = RESERVE_URL;
  }

  function verifyStep() {
    if (isSuccessPage()) return done();
    // 완료 문구가 늦게 뜨는 경우를 대비해 몇 번 더 확인
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (isSuccessPage()) { clearInterval(iv); done(); }
      else if (tries >= 6) {
        clearInterval(iv);
        if (isDetailPage()) {
          log('완료 확인이 안 됩니다. 목록으로 돌아가 재시도합니다.');
          state.step = 'scan'; saveState(state);
          location.href = RESERVE_URL;
        } else {
          log('완료 문구를 찾지 못했습니다. 내 예약조회에서 확인해 주세요.');
          state.running = false; saveState(state);
          refreshStatus('⚠️ 예약 여부 확인 필요 — 내 예약조회 확인 요망');
        }
      }
    }, 700);
  }

  function done() {
    state.running = false; state.step = 'scan'; saveState(state);
    refreshStatus('🎉 예약 완료!');
    log('예약이 완료된 것으로 확인했습니다. 내 예약조회에서 확인해 주세요.');
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = 880;
      o.start(); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      o.stop(ctx.currentTime + 0.8);
    } catch (e) {}
    alert('🎉 수련원 예약이 완료된 것으로 확인했습니다!\n내 예약조회에서 꼭 다시 확인해 주세요.');
  }

  function scheduleNext() {
    state.attempts++;
    saveState(state);
    refreshStatus();
    if (Date.now() > state.deadline) {
      state.running = false; saveState(state);
      refreshStatus('⏰ 최대 시도 시간이 지나 중단했습니다');
      log('최대 시도 시간 초과로 중단합니다.');
      return;
    }
    setTimeout(function () {
      if (state.running && !state.paused) scanStep();
    }, cfg.interval * 1000);
  }

  async function resume() {
    if (!state.running || state.paused) { refreshStatus(); return; }
    refreshStatus();
    await sleep(700);
    if (!state.running || state.paused) return;
    if (isSuccessPage() && state.step === 'verify') return verifyStep();
    if (state.step === 'detail' || isDetailPage()) {
      state.step = 'detail'; saveState(state);
      return detailStep();
    }
    if (state.step === 'verify') return verifyStep();
    return scanStep();
  }

  // -------------------------------------------------------------- buttons --
  function startFresh() {
    readCfgFromPanel();
    state = { running: true, paused: false, step: 'scan', attempts: 0,
              deadline: Date.now() + cfg.maxMinutes * 60000 };
    saveState(state);
    refreshStatus();
    log('시작합니다. 빈 방이 있으면 바로 예약을 시도합니다.');
    if (location.href.indexOf('MABAEAB') === -1) {
      location.href = RESERVE_URL; // 페이지가 바뀌면 자동으로 이어서 실행
    } else {
      resume();
    }
  }
  function restartFresh() {
    readCfgFromPanel();
    state = { running: true, paused: false, step: 'scan', attempts: 0,
              deadline: Date.now() + cfg.maxMinutes * 60000 };
    saveState(state);
    log('새 세션으로 다시 시작합니다.');
    location.href = RESERVE_URL;
  }
  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    saveState(state);
    refreshStatus();
    if (!state.paused) resume();
  }
  function stopAll() {
    state.running = false; state.paused = false; state.step = 'scan';
    saveState(state);
    refreshStatus('⏳ 대기 중…');
    log('종료했습니다.');
  }

  // ----------------------------------------------------------------- init --
  function init() {
    buildPanel();
    if (state.running && !state.paused) resume();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
