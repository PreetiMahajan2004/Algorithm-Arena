/* Algorithm Arena — UI: editor, rule builder, sandboxed runs (Web Worker), replay, tournament. */
(function () {
  'use strict';
  var P = window.ArenaPresets, Factory = window.ArenaEngineFactory;
  var $ = function (id) { return document.getElementById(id); };
  var CELL = 32, COLS = 15, ROWS = 15;

  /* ---------- storage ---------- */
  var KEY = 'algoarena.v1', S = {};
  try { S = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { S = {}; }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  S.codeA = S.codeA || P.STARTER;
  S.codeB = S.codeB || P.BOTS[1].code;
  S.rules = S.rules || JSON.parse(JSON.stringify(P.DEFAULT_RULES));
  S.def = S.def || P.DEFAULT_DEFAULT;
  S.mode = S.mode || 'code';
  S.opp = S.opp || 'hunter';
  S.seed = S.seed || 1;
  S.tour = S.tour || {};

  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2400); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------- sandboxed engine call ---------- */
  var WORKER_SRC = null;
  function workerSource() {
    if (!WORKER_SRC) {
      WORKER_SRC = '(function(){var E=(' + Factory.toString() + ')();' +
        'onmessage=function(e){var d=e.data;try{' +
        'if(d.type==="match")postMessage({ok:true,r:E.runMatch(d.a,d.b,d.seed)});' +
        'else postMessage({ok:true,r:E.runBatch(d.a,d.b,d.seeds)});' +
        '}catch(err){postMessage({ok:false,e:String(err&&err.message||err)})}};})();';
    }
    return WORKER_SRC;
  }
  function callEngine(msg, timeout) {
    return new Promise(function (resolve, reject) {
      var done = false, w = null, url = null;
      function end(fn, v) { if (done) return; done = true; try { w && w.terminate(); url && URL.revokeObjectURL(url); } catch (e) {} fn(v); }
      try {
        url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
        w = new Worker(url);
        w.onmessage = function (e) { e.data.ok ? end(resolve, e.data.r) : end(reject, new Error(e.data.e)); };
        w.onerror = function (e) { end(reject, new Error(e.message || 'Worker error')); };
        setTimeout(function () { end(reject, new Error('Your code ran too long — maybe an infinite loop? The fight was cancelled.')); }, timeout || 6000);
        w.postMessage(msg);
      } catch (err) {   // no Worker support: run directly (no infinite-loop protection)
        try {
          var E = Factory();
          end(resolve, msg.type === 'match' ? E.runMatch(msg.a, msg.b, msg.seed) : E.runBatch(msg.a, msg.b, msg.seeds));
        } catch (e2) { end(reject, e2); }
      }
    });
  }

  /* ---------- which code is "mine" / "red" ---------- */
  function myCode() { return S.mode === 'rules' ? P.rulesToCode(S.rules, S.def) : $('codeA').value; }
  function redBot() {
    if (S.opp === 'custom') return { name: 'Custom Red', code: $('codeB').value };
    var b = P.BOTS.filter(function (x) { return x.id === S.opp; })[0] || P.BOTS[1];
    return { name: b.name, code: b.code };
  }

  /* ---------- init controls ---------- */
  var oppSel = $('opp');
  P.BOTS.forEach(function (b) { var o = document.createElement('option'); o.value = b.id; o.textContent = b.name + ' (' + b.level + ')'; oppSel.appendChild(o); });
  var oc = document.createElement('option'); oc.value = 'custom'; oc.textContent = 'Custom (Red tab)'; oppSel.appendChild(oc);
  oppSel.value = S.opp;
  function showOppInfo() {
    var b = P.BOTS.filter(function (x) { return x.id === S.opp; })[0];
    $('oppInfo').textContent = b ? b.blurb : 'Fights the code in the Red bot tab.';
    $('nmB').textContent = '🔴 ' + (b ? b.name : 'Custom Red');
  }
  oppSel.onchange = function () { S.opp = oppSel.value; persist(); showOppInfo(); };
  showOppInfo();
  ['presetA', 'presetB'].forEach(function (id) {
    P.BOTS.forEach(function (b) { var o = document.createElement('option'); o.value = b.id; o.textContent = 'Preset: ' + b.name; $(id).appendChild(o); });
  });
  $('codeA').value = S.codeA; $('codeB').value = S.codeB; $('seed').value = S.seed;
  Array.prototype.forEach.call(document.getElementsByName('mode'), function (r) {
    r.checked = r.value === S.mode;
    r.onchange = function () { if (r.checked) { S.mode = r.value; persist(); toast('Your bot now runs from: ' + (S.mode === 'rules' ? 'Rule Builder' : 'Code')); } };
  });
  function setMode(m) { S.mode = m; Array.prototype.forEach.call(document.getElementsByName('mode'), function (r) { r.checked = r.value === m; }); persist(); }

  // textareas: Tab inserts spaces, autosave
  [['codeA', 'codeA'], ['codeB', 'codeB']].forEach(function (p) {
    var ta = $(p[0]);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') { e.preventDefault(); var s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; }
    });
    ta.addEventListener('input', function () { S[p[1]] = ta.value; persist(); if (p[0] === 'codeA') setMode('code'); });
  });
  function newMap() { try { window.__previewWalls = Factory().makeArena(S.seed); } catch (e) {} match = null; setPlaying(false); $('banner').hidden = true; $('scrub').max = 0; draw(); }
  $('seed').onchange = function () { S.seed = Math.max(1, Math.min(9999, Number($('seed').value) || 1)); $('seed').value = S.seed; persist(); newMap(); };
  $('btnRand').onclick = function () { S.seed = 1 + Math.floor(Math.random() * 9999); $('seed').value = S.seed; persist(); newMap(); };
  $('btnLoadA').onclick = function () { var b = P.BOTS.filter(function (x) { return x.id === $('presetA').value; })[0]; $('codeA').value = b.code; S.codeA = b.code; setMode('code'); persist(); toast('Loaded ' + b.name + ' — edit it and fight!'); };
  $('btnLoadB').onclick = function () { var b = P.BOTS.filter(function (x) { return x.id === $('presetB').value; })[0]; $('codeB').value = b.code; S.codeB = b.code; persist(); };
  $('btnStarter').onclick = function () { $('codeA').value = P.STARTER; S.codeA = P.STARTER; setMode('code'); persist(); };
  $('btnUseCustom').onclick = function () { S.opp = 'custom'; oppSel.value = 'custom'; persist(); showOppInfo(); fight(); };

  // tabs
  var tabs = $('tabs');
  tabs.onclick = function (e) {
    var t = e.target.getAttribute && e.target.getAttribute('data-t'); if (!t) return;
    Array.prototype.forEach.call(tabs.children, function (b) { b.classList.toggle('on', b === e.target); });
    ['code', 'rules', 'red', 'tour', 'docs'].forEach(function (n) { $('t-' + n).hidden = n !== t; });
  };

  // share / download / upload
  function shareLink() {
    var code = myCode(), enc;
    try { enc = btoa(unescape(encodeURIComponent(code))); } catch (e) { toast('Could not encode code'); return; }
    var url = location.href.split('#')[0] + '#bot=' + enc;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast('Link copied! Send it to a friend.'); }, function () { prompt('Copy this link:', url); });
    else prompt('Copy this link:', url);
  }
  $('btnShare').onclick = shareLink;
  $('btnDown').onclick = function () {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([myCode()], { type: 'text/javascript' })); a.download = 'my-arena-bot.js';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  $('btnUp').onclick = function () { $('fileUp').click(); };
  $('fileUp').onchange = function () {
    var f = $('fileUp').files[0]; if (!f) return;
    var fr = new FileReader(); fr.onload = function () { $('codeA').value = fr.result; S.codeA = fr.result; setMode('code'); persist(); toast('Loaded ' + f.name); }; fr.readAsText(f);
  };
  (function loadFromHash() {
    var m = /#bot=([A-Za-z0-9+/=_-]+)/.exec(location.hash);
    if (!m) return;
    try { var code = decodeURIComponent(escape(atob(m[1]))); $('codeA').value = code; S.codeA = code; S.mode = 'code'; toast('Loaded a shared bot from the link. Press Fight!'); } catch (e) {}
  })();

  /* ---------- rule builder ---------- */
  function optHtml(list, sel, withNone) {
    return (withNone ? '<option value="">(none)</option>' : '') + list.map(function (c) { return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('');
  }
  function condHtml(c, idx, which, optional) {
    var def = c ? P.CONDITIONS.filter(function (x) { return x.id === c.id; })[0] : null;
    return '<select data-i="' + idx + '" data-w="' + which + '" data-f="id">' + optHtml(P.CONDITIONS, c && c.id, optional) + '</select>' +
      (def && def.n !== undefined ? '<input type="number" data-i="' + idx + '" data-w="' + which + '" data-f="n" value="' + (c.n !== undefined ? c.n : def.n) + '">' : '');
  }
  function renderRules() {
    var box = $('rules'); box.innerHTML = '';
    S.rules.forEach(function (r, i) {
      var d = document.createElement('div'); d.className = 'rule';
      d.innerHTML = '<b>IF</b>' + condHtml(r.c1, i, 'c1', false) + '<b>AND</b>' + condHtml(r.c2, i, 'c2', true) +
        '<b>THEN</b><select data-i="' + i + '" data-f="act">' + optHtml(P.ACTS, r.act) + '</select>' +
        '<span class="x"><button class="mini" data-up="' + i + '">↑</button><button class="mini" data-down="' + i + '">↓</button><button class="mini" data-del="' + i + '">✕</button></span>';
      box.appendChild(d);
    });
    $('defAct').innerHTML = optHtml(P.ACTS, S.def);
    $('genCode').textContent = P.rulesToCode(S.rules, S.def);
  }
  $('rules').addEventListener('change', function (e) {
    var el = e.target, i = el.getAttribute('data-i'); if (i === null) return;
    var r = S.rules[Number(i)], f = el.getAttribute('data-f'), w = el.getAttribute('data-w');
    if (f === 'act') r.act = el.value;
    else if (f === 'id') {
      if (!el.value) r[w] = null;
      else { var def = P.CONDITIONS.filter(function (x) { return x.id === el.value; })[0]; r[w] = { id: el.value, n: def.n !== undefined ? def.n : 0 }; }
    } else if (f === 'n') r[w].n = Number(el.value) || 0;
    persist(); renderRules();
  });
  $('rules').addEventListener('click', function (e) {
    var b = e.target, up = b.getAttribute('data-up'), dn = b.getAttribute('data-down'), del = b.getAttribute('data-del');
    if (up !== null && Number(up) > 0) { var u = Number(up), t = S.rules[u]; S.rules[u] = S.rules[u - 1]; S.rules[u - 1] = t; }
    else if (dn !== null && Number(dn) < S.rules.length - 1) { var d = Number(dn), t2 = S.rules[d]; S.rules[d] = S.rules[d + 1]; S.rules[d + 1] = t2; }
    else if (del !== null) S.rules.splice(Number(del), 1);
    else return;
    persist(); renderRules();
  });
  $('btnAddRule').onclick = function () { S.rules.push({ c1: { id: 'sight', n: 0 }, c2: null, act: 'shoot' }); persist(); renderRules(); };
  $('defAct').onchange = function () { S.def = $('defAct').value; persist(); renderRules(); };
  $('btnUseRules').onclick = function () { setMode('rules'); toast('Rule Builder is now your bot. Press Fight!'); };
  $('btnRulesToCode').onclick = function () { var c = P.rulesToCode(S.rules, S.def); $('codeA').value = c; S.codeA = c; setMode('code'); persist(); toast('Copied to the code editor'); tabs.children[0].click(); };
  renderRules();

  /* ---------- replay viewer ---------- */
  var cv = $('cv'), ctx = cv.getContext('2d');
  var match = null, idx = 0, playing = false, acc = 0, lastT = 0;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  function drawBot(b, col, name) {
    var cx = b.x * CELL + CELL / 2, cy = b.y * CELL + CELL / 2;
    ctx.save();
    if (b.sh) { ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(cx, cy, 15, 0, 6.283); ctx.stroke(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#9fe8ff'; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = b.hp <= 0 ? '#555' : col; ctx.beginPath(); ctx.arc(cx, cy, 11, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#0008'; ctx.lineWidth = 2; ctx.stroke();
    // nose
    var dx = DX[b.d], dy = DY[b.d];
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.moveTo(cx + dx * 17, cy + dy * 17);
    ctx.lineTo(cx + dx * 7 - dy * 6, cy + dy * 7 + dx * 6);
    ctx.lineTo(cx + dx * 7 + dy * 6, cy + dy * 7 - dx * 6);
    ctx.closePath(); ctx.fill();
    // hp bar
    ctx.fillStyle = '#000a'; ctx.fillRect(cx - 12, cy - 21, 24, 4);
    ctx.fillStyle = b.hp > 50 ? '#52e08a' : b.hp > 25 ? '#ffc65a' : '#ff5d6c'; ctx.fillRect(cx - 12, cy - 21, 24 * b.hp / 100, 4);
    ctx.restore();
  }
  function draw() {
    var i, j;
    ctx.fillStyle = '#0b1229'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#ffffff0a'; ctx.lineWidth = 1;
    for (i = 0; i <= COLS; i++) { ctx.beginPath(); ctx.moveTo(i * CELL + .5, 0); ctx.lineTo(i * CELL + .5, cv.height); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * CELL + .5); ctx.lineTo(cv.width, i * CELL + .5); ctx.stroke(); }
    var walls = match ? match.walls : window.__previewWalls;
    if (walls) for (j = 0; j < ROWS; j++) for (i = 0; i < COLS; i++) if (walls[j][i]) {
      ctx.fillStyle = '#2b3a78'; ctx.fillRect(i * CELL + 1, j * CELL + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = '#3d4f9c'; ctx.fillRect(i * CELL + 1, j * CELL + 1, CELL - 2, 4);
    }
    var f = match ? match.frames[idx] : null;
    if (!f) { // preview spawn points
      drawBot({ x: 1, y: 1, d: 1, hp: 100, sh: false }, '#4da3ff');
      drawBot({ x: COLS - 2, y: ROWS - 2, d: 3, hp: 100, sh: false }, '#ff5d6c');
      return;
    }
    f.o.forEach(function (o) {
      var cx = o[0] * CELL + CELL / 2, cy = o[1] * CELL + CELL / 2, pul = 1 + Math.sin(performance.now() / 250) * 0.08;
      ctx.fillStyle = '#52e08a33'; ctx.beginPath(); ctx.arc(cx, cy, 13 * pul, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#52e08a'; ctx.fillRect(cx - 7, cy - 2, 14, 4); ctx.fillRect(cx - 2, cy - 7, 4, 14);
    });
    f.s.forEach(function (s) {
      ctx.strokeStyle = s.by === 0 ? '#9fd0ff' : '#ff9aa4'; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(s.f[0] * CELL + CELL / 2, s.f[1] * CELL + CELL / 2); ctx.lineTo(s.t[0] * CELL + CELL / 2, s.t[1] * CELL + CELL / 2); ctx.stroke();
      ctx.globalAlpha = 1;
      if (s.h) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.t[0] * CELL + CELL / 2, s.t[1] * CELL + CELL / 2, 9, 0, 6.283); ctx.fill(); }
    });
    drawBot(f.b[0], '#4da3ff'); drawBot(f.b[1], '#ff5d6c');
  }
  function renderHud() {
    var f = match && match.frames[idx]; if (!f) return;
    $('hpA').style.width = f.b[0].hp + '%'; $('hpB').style.width = f.b[1].hp + '%';
    $('enA').style.width = f.b[0].en * 10 + '%'; $('enB').style.width = f.b[1].en * 10 + '%';
    $('actA').textContent = 'HP ' + f.b[0].hp + ' · EN ' + f.b[0].en + (f.b[0].a ? ' · ' + f.b[0].a : '');
    $('actB').textContent = 'HP ' + f.b[1].hp + ' · EN ' + f.b[1].en + (f.b[1].a ? ' · ' + f.b[1].a : '');
    $('tickLabel').textContent = 'tick ' + f.t;
    $('scrub').value = idx;
    var lines = $('log').children;
    for (var k = 0; k < lines.length; k++) lines[k].classList.toggle('now', Number(lines[k].getAttribute('data-t')) === f.t);
  }
  function setIdx(n) { if (!match) return; idx = Math.max(0, Math.min(match.frames.length - 1, n)); renderHud(); draw(); showBannerIfEnd(); }
  function showBannerIfEnd() { $('banner').hidden = !(match && idx === match.frames.length - 1 && match.__banner); if (!$('banner').hidden) $('banner').innerHTML = match.__banner; }
  function setPlaying(p) { playing = p; $('bPlay').textContent = p ? '⏸' : '▶'; lastT = performance.now(); }
  $('bPlay').onclick = function () { if (!match) return; if (idx >= match.frames.length - 1) setIdx(0); setPlaying(!playing); };
  $('bNext').onclick = function () { setPlaying(false); setIdx(idx + 1); };
  $('bPrev').onclick = function () { setPlaying(false); setIdx(idx - 1); };
  $('bFirst').onclick = function () { setPlaying(false); setIdx(0); };
  $('scrub').oninput = function () { setPlaying(false); setIdx(Number($('scrub').value)); };
  function loop(now) {
    if (playing && match) {
      acc += (now - lastT) / 1000 * Number($('speed').value); lastT = now;
      while (acc >= 1) { acc -= 1; if (idx < match.frames.length - 1) { idx++; } else { setPlaying(false); break; } }
      renderHud(); draw(); showBannerIfEnd();
    } else lastT = now;
    if (!playing && match) draw(); // keeps orbs pulsing
    requestAnimationFrame(loop);
  }

  function buildLog(m) {
    var log = $('log'); log.innerHTML = '';
    var names = ['You', m.oppName];
    m.frames.forEach(function (f) {
      f.e.forEach(function (ev) {
        var p = ev.split(':'), who = Number(p[0]);
        if (isNaN(who)) return;
        var txt = null, cls = who === 0 ? 'a' : 'b';
        if (p[1] === 'hit') txt = names[who] + ' hit ' + names[1 - who] + (p[2] ? ' (shield blocked most)' : ' (−20)');
        else if (p[1] === 'orb') { txt = names[who] + ' repaired +30 HP'; cls = 'g'; }
        else if (p[1] === 'miss') txt = names[who] + ' missed';
        else if (p[1] === 'noenergy') txt = names[who] + ' lacked energy';
        if (txt) { var d = document.createElement('div'); d.className = cls; d.setAttribute('data-t', f.t); d.textContent = 't' + f.t + ' · ' + txt; d.onclick = function () { setPlaying(false); setIdx(f.t); }; log.appendChild(d); }
      });
    });
    if (!log.children.length) log.innerHTML = '<span class="dim">No hits this match — try aiming!</span>';
  }
  function showErr(id, msg) { var e = $(id); e.hidden = !msg; e.textContent = msg ? '⚠ ' + msg : ''; }

  /* ---------- fight ---------- */
  var busy = false;
  function fight() {
    if (busy) return;
    var red = redBot(), mine = myCode(), seed = S.seed;
    busy = true; $('btnFight').disabled = true; $('btnFight').textContent = '… fighting';
    showErr('errA', null); showErr('errB', null);
    callEngine({ type: 'match', a: mine, b: red.code, seed: seed }, 6000).then(function (r) {
      r.oppName = red.name;
      var title = r.winner === 0 ? '🏆 You win!' : r.winner === 1 ? '💀 ' + esc(red.name) + ' wins' : '🤝 Draw';
      r.__banner = title + '<small>' + esc(r.reason) + ' · tick ' + r.ticks + ' · HP ' + r.hp[0] + ' vs ' + r.hp[1] + '</small>';
      match = r; idx = 0; acc = 0;
      $('scrub').max = r.frames.length - 1;
      buildLog(r); setIdx(0); setPlaying(true);
      showErr('errA', r.errors[0]); showErr('errB', r.errors[1]);
      if (r.errors[0]) { toast('Your bot has an error — see the message under the editor'); if (S.mode === 'code') tabs.children[0].click(); }
    }).catch(function (e) {
      toast(e.message); showErr('errA', e.message);
    }).then(function () { busy = false; $('btnFight').disabled = false; $('btnFight').textContent = '⚔ Fight!'; });
  }
  $('btnFight').onclick = fight;

  /* ---------- tournament ---------- */
  $('btnTour').onclick = function () {
    var out = $('tourOut'), mine = myCode(), seeds = [1, 2, 3, 4, 5, 6], results = [], k = 0;
    $('btnTour').disabled = true; out.innerHTML = '<p class="dim">Running…</p>';
    function next() {
      if (k >= P.BOTS.length) return finish();
      var b = P.BOTS[k++];
      callEngine({ type: 'batch', a: mine, b: b.code, seeds: seeds }, 15000).then(function (r) { results.push({ bot: b, r: r }); out.innerHTML = '<p class="dim">Running… ' + results.length + '/' + P.BOTS.length + '</p>'; next(); })
        .catch(function (e) { out.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; $('btnTour').disabled = false; });
    }
    function finish() {
      var beaten = 0, html = '<table><tr><th>Opponent</th><th>W</th><th>L</th><th>D</th><th>Win rate</th></tr>';
      results.forEach(function (x) {
        var t = x.r.wins + x.r.losses + x.r.draws, rate = Math.round(100 * x.r.wins / t);
        if (x.r.wins > x.r.losses) beaten++;
        html += '<tr><td>' + esc(x.bot.name) + ' <small class="dim">' + x.bot.level + '</small></td><td class="w">' + x.r.wins + '</td><td class="l">' + x.r.losses + '</td><td>' + x.r.draws +
          '</td><td><div class="meter"><i style="width:' + rate + '%"></i></div></td></tr>';
      });
      html += '</table>';
      var err = results[0] && results[0].r.errA;
      var verdict = err ? 'Your bot had an error: ' + esc(err) : beaten === P.BOTS.length ? '👑 Grandmaster — you beat every opponent including the Tactician!' :
        beaten >= 4 ? '🥇 Champion — only one opponent left to beat.' : beaten >= 2 ? '🥈 Contender — keep tuning your strategy.' : beaten >= 1 ? '🥉 Rookie — read the Docs tab for ideas.' : 'No wins yet — start from the Hunter preset and improve it!';
      html += '<div class="verdict">' + verdict + '</div>';
      out.innerHTML = html;
      S.tour.best = Math.max(S.tour.best || 0, beaten); persist();
      $('btnTour').disabled = false;
    }
    next();
  };

  /* ---------- boot ---------- */
  try { var E0 = Factory(); window.__previewWalls = E0.makeArena(S.seed); } catch (e) {}
  requestAnimationFrame(loop); draw();
  window.__arena = { fight: fight, get match() { return match; } }; // handy for testing
})();
