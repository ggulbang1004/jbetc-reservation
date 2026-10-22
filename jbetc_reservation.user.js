// ==UserScript==
// @name         교직원수련원 선착순 예약 도우미
// @namespace    https://github.com/ggulbang1004/jbetc-reservation
// @version      1.1.0
// @description  전북특별자치도교육청교직원수련원 선착순 예약: 날짜는 직접 선택, 프로그램이 본관/별관을 번갈아 조회하며 빈 객실이 있으면 자동 예약
// @match        https://office.jbedu.kr/jbetc/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ggulbang1004/jbetc-reservation/main/jbetc_reservation.user.js
// @downloadURL  https://raw.githubusercontent.com/ggulbang1004/jbetc-reservation/main/jbetc_reservation.user.js
// ==/UserScript==

(function () {
  'use strict';

  var RESERVE_URL = 'https://office.jbedu.kr/jbetc/MABAEAB/index.do';
  var SKEY = 'jbetc_bot_state_v2';
  var CKEY = 'jbetc_bot_cfg_v2';

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
    { running: false, paused: false, step: 'scan', attempts: 0,
      deadline: 0, justSearched: false },
    loadState());

  var cfg = Object.assign({
    guests: 2, building: 'alt', mode: 'priority',
    priorities: '6인실\n2인실', interval: 1.5, maxMinutes: 30, dryRun: true
  }, loadCfg());

  // ---------------------------------------------------------------- panel --
  var panel, statusEl, logEl, clockEl;
  var inputs = {};

  function buildPanel() {
    if (document.getElementById('jbetc-bot-panel')) return;
    panel = document.createElement('div');
    panel.id = 'jbetc-bot-panel';
    panel.style.cssText =
      'position:fixed;top:12px;right:12px;width:308px;z-index:2147483647;' +
      'background:#fff;border:1px solid #888;border-radius:10px;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.25);padding:10px 12px;' +
      'font-family:"Malgun Gothic",sans-serif;font-size:13px;color:#222;';
    panel.innerHTML =
      '<div style="font-weight:bold;font-size:14px;margin-bottom:4px;">' +
      '🏠 수련원 선착순 예약 도우미 <span style="color:#888;font-size:11px;">v1.1</span></div>' +
      '<div style="font-size:12px;color:#555;margin-bottom:4px;">' +
      '날짜·숙박일수는 직접 선택해 두세요.<br>프로그램이 조회와 예약을 합니다.</div>' +

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

      '<div style="margin:4px 0;">숙박인원(성인) <input type="number" id="jb-guests" ' +
      'min="1" max="6" style="width:40px;">명 · 간격 ' +
      '<input type="number" id="jb-int" step="0.5" min="0.5" ' +
      'style="width:48px;">초 · 최대 ' +
      '<input type="number" id="jb-max" min="1" style="width:44px;">분</div>' +
      '<div style="margin:4px 0;"><label><input type="checkbox" id="jb-dry"> ' +
      '연습 모드 (마지막 예약하기 직전에 멈춤)</label></div>' +

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
    inputs.guests = panel.querySelector('#jb-guests');
    inputs.pri = panel.querySelector('#jb-pri');
    inputs.interval = panel.querySelector('#jb-int');
    inputs.max = panel.querySelector('#jb-max');
    inputs.dry = panel.querySelector('#jb-dry');

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
  function inChromeArea(e) {
    // 상단 메뉴/헤더/푸터 안의 요소는 제외 (메뉴의 '예약하기' 링크 오인 방지)
    var n = e;
    while (n && n !== document.body) {
      var s = (n.id || '') + ' ' + (typeof n.className === 'string'
        ? n.className : '');
      if (/(header|gnb|lnb|topmenu|mainmenu|footer|foot|nav|menu-wrap|skip)/i
          .test(s)) return true;
      if (n.id === 'jbetc-bot-panel') return true;
      n = n.parentElement;
    }
    return false;
  }
  function ownText(e) {
    return (e.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function findExact(text, opts) {
    // 텍스트가 정확히 일치하는 가장 안쪽(깊은) 요소를 찾는다 — div 버튼 대응
    opts = opts || {};
    var nodes = document.querySelectorAll(
      'a, button, input, div, span, td, li, label');
    var best = null, bestDepth = -1;
    for (var i = 0; i < nodes.length; i++) {
      var e = nodes[i];
      if (!visible(e)) continue;
      var t = e.tagName === 'INPUT' ? (e.value || '').trim() : ownText(e);
      if (t !== text) continue;
      if (!opts.allowChrome && inChromeArea(e)) continue;
      var depth = 0, n = e;
      while (n) { depth++; n = n.parentElement; }
      if (depth > bestDepth) { best = e; bestDepth = depth; }
    }
    return best;
  }
  function findAllExact(text) {
    var out = [], seen = [];
    var nodes = document.querySelectorAll(
      'a, button, input, div, span, td, li, label');
    for (var i = 0; i < nodes.length; i++) {
      var e = nodes[i];
      if (!visible(e)) continue;
      var t = e.tagName === 'INPUT' ? (e.value || '').trim() : ownText(e);
      if (t !== text) continue;
      if (inChromeArea(e)) continue;
      out.push(e);
    }
    // 바깥 요소가 안쪽 요소를 포함하면 안쪽만 남긴다
    return out.filter(function (e) {
      return !out.some(function (o) { return o !== e && e.contains(o); });
    });
  }
  function rowText(e) {
    var row = e.closest ? (e.closest('tr') || e.closest('li')) : null;
    if (row && row.innerText) return ownText(row);
    var n = e, txt = '';
    for (var i = 0; i < 5 && n; i++) {
      n = n.parentElement;
      if (n) txt = n.innerText || '';
    }
    return txt.replace(/\s+/g, ' ').trim();
  }
  function blockText(e, up) {
    var n = e;
    for (var i = 0; i < (up || 6) && n; i++) n = n.parentElement;
    return n ? (n.innerText || '') : '';
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------------------------------------------------- 본관/별관 고르기 --
  function buildingRadio(kw) {
    // kw('본관'/'별관')와 연결된 라디오 input과 클릭 대상(label 등)을 찾는다
    var radios = document.querySelectorAll('input[type="radio"]');
    for (var i = 0; i < radios.length; i++) {
      var r = radios[i];
      var label = null;
      if (r.id) label = document.querySelector('label[for="' + r.id + '"]');
      if (!label && r.closest) label = r.closest('label');
      var txt = label ? ownText(label)
        : ((r.parentElement && r.parentElement.innerText) || '');
      if (txt === kw || txt.indexOf(kw) === 0) {
        return { input: r, target: label || r, checked: r.checked };
      }
    }
    // 라디오가 아닌 알약형 토글이면 텍스트가 정확히 일치하는 요소
    var pill = findExact(kw, { allowChrome: true });
    if (pill) {
      var cls = (pill.className || '') + ' ' +
        ((pill.parentElement && pill.parentElement.className) || '');
      return { input: null, target: pill,
               checked: /(on|active|selected|checked)/i.test(cls) ||
                        pill.getAttribute('aria-pressed') === 'true' };
    }
    return null;
  }

  function selectBuilding(kw) {
    var info = buildingRadio(kw);
    if (!info) { log(kw + ' 버튼을 찾지 못했습니다.'); return false; }
    if (info.checked) return true;
    info.target.click();
    log(kw + ' 선택');
    return true;
  }

  function turnBuilding(attempt) {
    if (cfg.building === 'main') return '본관';
    if (cfg.building === 'annex') return '별관';
    return attempt % 2 === 0 ? '본관' : '별관'; // 교대
  }

  // -------------------------------------------------------------- engine --
  function isDetailPage() {
    var t = document.body ? document.body.innerText : '';
    return t.indexOf('총금액') !== -1 && t.indexOf('조식') !== -1;
  }
  function isSuccessPage() {
    var t = document.body ? document.body.innerText : '';
    return t.indexOf('예약이 완료') !== -1 || t.indexOf('예약완료') !== -1 ||
      (t.indexOf('예약번호') !== -1 && t.indexOf('내 예약조회') !== -1);
  }

  function pickRoom() {
    var btns = findAllExact('예약하기');
    if (!btns.length) return null;
    var want = turnBuilding(state.attempts);
    var other = want === '본관' ? '별관' : '본관';
    var cands = btns.map(function (b) { return { btn: b, text: rowText(b) }; });
    // 이번 차례 건물과 다른 건물이 행 텍스트에 명시된 경우는 제외
    var filtered = cands.filter(function (c) {
      return !(c.text.indexOf(other) !== -1 && c.text.indexOf(want) === -1);
    });
    if (filtered.length) cands = filtered;
    if (cfg.mode === 'priority') {
      var pris = priorityList();
      for (var i = 0; i < pris.length; i++) {
        for (var j = 0; j < cands.length; j++) {
          if (cands[j].text.indexOf(pris[i]) !== -1) return cands[j];
        }
      }
      return null;
    }
    return cands[0];
  }

  async function scanResults() {
    var pick = pickRoom();
    if (pick) {
      log('객실 발견: ' + pick.text.slice(0, 50) + ' → 예약하기 클릭');
      state.step = 'detail'; saveState(state);
      pick.btn.click();
      await sleep(1300);
      if (isDetailPage()) return detailStep();
      return; // 화면 전환 시 로드 후 detail 단계로 이어감
    }
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
      if (state.running && !state.paused) cycle();
    }, cfg.interval * 1000);
  }

  async function cycle() {
    if (!state.running || state.paused) { refreshStatus(); return; }
    if (isDetailPage()) return detailStep();
    if (state.justSearched) {
      // 조회 클릭으로 페이지가 새로고침된 경우: 결과만 확인
      state.justSearched = false; saveState(state);
      return scanResults();
    }
    var kw = turnBuilding(state.attempts);
    selectBuilding(kw);
    await sleep(200);
    var search = findExact('조회');
    if (search) {
      state.justSearched = true; saveState(state);
      search.click();
      log(kw + ' 조회 클릭');
      await sleep(1100);
      state.justSearched = false; saveState(state);
      if (!state.running || state.paused) return;
      return scanResults();
    }
    log('조회 버튼을 찾지 못했습니다. 현재 목록에서 바로 찾습니다.');
    return scanResults();
  }

  async function detailStep() {
    // 숙박인원 설정 — '조식' 영역의 select는 건드리지 않음 (조식은 0명 유지)
    var setGuests = false;
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
          setGuests = true;
          break;
        }
      }
      if (setGuests) break;
    }
    if (!setGuests) log('숙박인원 선택칸을 자동으로 찾지 못했습니다. (기본값으로 진행)');
    await sleep(200);

    var submits = findAllExact('예약하기');
    if (!submits.length) {
      log('상세 화면에서 예약하기 버튼을 찾지 못했습니다. 목록으로 돌아갑니다.');
      state.step = 'scan'; saveState(state);
      location.href = RESERVE_URL;
      return;
    }
    // 총금액 근처에 있는 버튼을 우선, 없으면 마지막 버튼
    var submit = submits[submits.length - 1];
    for (var k = 0; k < submits.length; k++) {
      if (blockText(submits[k], 8).indexOf('총금액') !== -1) {
        submit = submits[k]; break;
      }
    }
    if (cfg.dryRun) {
      submit.style.outline = '4px solid red';
      submit.scrollIntoView({ block: 'center' });
      state.running = false; state.step = 'scan'; saveState(state);
      refreshStatus('🧪 연습 모드: 마지막 예약하기 직전에서 멈췄습니다');
      log('연습 모드 — 실제 예약을 하지 않았습니다. 빨간 테두리 버튼이 맞는지 확인해 주세요.');
      return;
    }
    state.step = 'verify'; saveState(state);
    log('최종 예약하기 클릭!');
    submit.click();
    await sleep(1500);
    if (isSuccessPage()) return done();
    if (!isDetailPage()) return; // 화면이 바뀌면 로드 후 verify 단계에서 확인
    log('예약이 완료되지 않은 것 같습니다. 목록으로 돌아가 재시도합니다.');
    state.step = 'scan'; saveState(state);
    location.href = RESERVE_URL;
  }

  function verifyStep() {
    if (isSuccessPage()) return done();
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

  async function resume() {
    if (!state.running || state.paused) { refreshStatus(); return; }
    refreshStatus();
    await sleep(700);
    if (!state.running || state.paused) return;
    if (state.step === 'verify') return verifyStep();
    if (state.step === 'detail' || isDetailPage()) {
      state.step = 'detail'; saveState(state);
      return detailStep();
    }
    return cycle();
  }

  // -------------------------------------------------------------- buttons --
  function startFresh() {
    readCfgFromPanel();
    state = { running: true, paused: false, step: 'scan', attempts: 0,
              deadline: Date.now() + cfg.maxMinutes * 60000,
              justSearched: false };
    saveState(state);
    refreshStatus();
    log('시작합니다. 날짜·숙박일수는 직접 선택하신 값으로 조회합니다.');
    if (location.href.indexOf('MABAEAB') === -1) {
      location.href = RESERVE_URL;
    } else {
      resume();
    }
  }
  function restartFresh() {
    readCfgFromPanel();
    state = { running: true, paused: false, step: 'scan', attempts: 0,
              deadline: Date.now() + cfg.maxMinutes * 60000,
              justSearched: false };
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
    state.justSearched = false;
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
