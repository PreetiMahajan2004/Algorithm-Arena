/* Algorithm Arena — battle engine (pure logic, no DOM).
   ArenaEngineFactory is self-contained so its source can be injected into a Web Worker
   (this keeps infinite loops in player code from freezing the page, even on file://). */
function ArenaEngineFactory() {
  'use strict';
  var COLS = 15, ROWS = 15, MAX_TICKS = 200;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];   // 0=N 1=E 2=S 3=W
  var ACTIONS = { forward: 1, left: 1, right: 1, shoot: 1, shield: 1, wait: 1 };
  var HP = 100, MAX_EN = 10, SHOT_COST = 3, SHIELD_COST = 1, DMG = 20, DMG_SHIELDED = 5, ORB_HEAL = 30;

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- arena ---------- */
  function connected(walls, x0, y0, x1, y1) {
    var seen = {}, q = [[x0, y0]], k = 0;
    seen[x0 + ',' + y0] = 1;
    while (k < q.length) {
      var c = q[k++];
      if (c[0] === x1 && c[1] === y1) return true;
      for (var d = 0; d < 4; d++) {
        var nx = c[0] + DX[d], ny = c[1] + DY[d];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || walls[ny][nx] || seen[nx + ',' + ny]) continue;
        seen[nx + ',' + ny] = 1; q.push([nx, ny]);
      }
    }
    return false;
  }

  // Point-symmetric (180 degree) map so both sides are always fair.
  function makeArena(seed) {
    var rnd = mulberry(seed * 2654435761), walls, tries = 0;
    do {
      walls = [];
      for (var y = 0; y < ROWS; y++) { walls.push([]); for (var x = 0; x < COLS; x++) walls[y].push(false); }
      for (var y2 = 0; y2 < ROWS; y2++) {
        for (var x2 = 0; x2 < COLS; x2++) {
          var idx = y2 * COLS + x2, mid = (ROWS * COLS - 1) / 2;
          if (idx > mid) continue;
          if (Math.abs(x2 - 1) + Math.abs(y2 - 1) < 4) continue;      // keep spawn zones open
          if (rnd() < 0.15) { walls[y2][x2] = true; walls[ROWS - 1 - y2][COLS - 1 - x2] = true; }
        }
      }
      tries++;
    } while (!connected(walls, 1, 1, COLS - 2, ROWS - 2) && tries < 50);
    return walls;
  }

  /* ---------- the match ---------- */
  function compile(code) {
    try {
      var fn = (new Function(code + '\n;return (typeof think==="function")?think:null;'))();
      if (!fn) return { err: 'Your code must define  function think(s) { ... }' };
      return { fn: fn };
    } catch (e) { return { err: 'Syntax/compile error: ' + (e && e.message || e) }; }
  }

  function runMatch(codeA, codeB, seed, opts) {
    opts = opts || {};
    var walls = makeArena(seed), rndMap = mulberry(seed + 99991);
    var cA = compile(codeA), cB = compile(codeB), errors = [cA.err || null, cB.err || null];
    var fns = [cA.fn || null, cB.fn || null];
    var rnds = [mulberry(seed * 31 + 1), mulberry(seed * 31 + 2)];
    var mem = [{}, {}];
    var bots = [
      { x: 1, y: 1, dir: 1, hp: HP, energy: MAX_EN },
      { x: COLS - 2, y: ROWS - 2, dir: 3, hp: HP, energy: MAX_EN }
    ];
    var orbs = [], frames = [], winner = -1, reason = '';

    function blocked(x, y) { return x < 0 || y < 0 || x >= COLS || y >= ROWS || walls[y][x]; }
    function snapshot(t, acts, shields, shots, ev) {
      return {
        t: t,
        b: bots.map(function (b, i) { return { x: b.x, y: b.y, d: b.dir, hp: b.hp, en: b.energy, a: acts ? acts[i] : '', sh: shields ? shields[i] : false }; }),
        o: orbs.map(function (o) { return [o.x, o.y]; }),
        s: shots || [], e: ev || []
      };
    }
    function rayHits(from, dir, tx, ty) {      // is (tx,ty) on the ray from `from` going `dir`, with no wall between?
      var x = from.x, y = from.y;
      for (;;) {
        x += DX[dir]; y += DY[dir];
        if (blocked(x, y)) return false;
        if (x === tx && y === ty) return true;
      }
    }
    function bfs(sx, sy) {
      var dist = [], y, x;
      for (y = 0; y < ROWS; y++) { dist.push([]); for (x = 0; x < COLS; x++) dist[y].push(-1); }
      var q = [[sx, sy]], k = 0; dist[sy][sx] = 0;
      while (k < q.length) {
        var c = q[k++];
        for (var d = 0; d < 4; d++) {
          var nx = c[0] + DX[d], ny = c[1] + DY[d];
          if (blocked(nx, ny) || dist[ny][nx] >= 0) continue;
          dist[ny][nx] = dist[c[1]][c[0]] + 1; q.push([nx, ny]);
        }
      }
      return dist;
    }
    function turnAction(cur, want) {           // shortest rotation from cur to want
      if (cur === want) return 'forward';
      return ((cur + 3) % 4 === want) ? 'left' : 'right';
    }

    // The object handed to think(s): a fresh snapshot each tick (changing it never changes the real game).
    function makeView(i, tick) {
      var me = bots[i], en = bots[1 - i], myDist = null;
      function copyBot(b) { return { x: b.x, y: b.y, dir: b.dir, hp: b.hp, energy: b.energy }; }
      function dm() { return myDist || (myDist = bfs(me.x, me.y)); }
      var orbList = orbs.map(function (o) { var d = dm()[o.y][o.x]; return { x: o.x, y: o.y, d: d < 0 ? 999 : d }; });
      var nearest = null;
      orbList.forEach(function (o) { if (!nearest || o.d < nearest.d) nearest = o; });
      var s = {
        tick: tick, cols: COLS, rows: ROWS, me: copyBot(me), enemy: copyBot(en), orbs: orbList, nearestOrb: nearest,
        memory: mem[i], DIR: { N: 0, E: 1, S: 2, W: 3 },
        random: rnds[i],
        wallAhead: blocked(me.x + DX[me.dir], me.y + DY[me.dir]),
        enemyInSight: rayHits(me, me.dir, en.x, en.y),
        enemyAimingAtMe: rayHits(en, en.dir, me.x, me.y),
        isWall: function (x, y) { return blocked(x, y); },
        dist: function (a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); },
        // action that walks the shortest path towards (x,y)
        stepToward: function (x, y) {
          if (blocked(x, y)) return 'wait';
          var d = bfs(x, y), best = -1, bv = d[me.y][me.x];
          if (bv <= 0) return 'wait';
          for (var k = 0; k < 4; k++) {
            var nx = me.x + DX[k], ny = me.y + DY[k];
            if (blocked(nx, ny) || d[ny][nx] < 0) continue;
            if (d[ny][nx] < bv) { bv = d[ny][nx]; best = k; if (k === me.dir) break; }
          }
          return best < 0 ? 'wait' : turnAction(me.dir, best);
        },
        // action that walks away from (x,y) (maximises path distance)
        stepAway: function (x, y) {
          var d = bfs(x, y), best = -1, bv = d[me.y][me.x];
          for (var k = 0; k < 4; k++) {
            var nx = me.x + DX[k], ny = me.y + DY[k];
            if (blocked(nx, ny) || d[ny][nx] < 0) continue;
            if (d[ny][nx] > bv) { bv = d[ny][nx]; best = k; }
          }
          return best < 0 ? 'wait' : turnAction(me.dir, best);
        },
        // if (x,y) is in a straight clear line from me, returns "left"/"right" to rotate towards it
        // ("shoot" if already facing it), otherwise null
        aimAt: function (x, y) {
          for (var k = 0; k < 4; k++) {
            if (rayHits(me, k, x, y)) return k === me.dir ? 'shoot' : turnAction(me.dir, k);
          }
          return null;
        }
      };
      return s;
    }

    function decide(i, tick) {
      if (!fns[i]) return 'wait';
      try {
        var a = fns[i](makeView(i, tick));
        if (typeof a === 'string') a = a.toLowerCase();
        if (!ACTIONS[a]) { errors[i] = errors[i] || 'think() returned "' + a + '" at tick ' + tick + ' (use forward, left, right, shoot, shield or wait)'; return 'wait'; }
        return a;
      } catch (e) {
        errors[i] = errors[i] || 'Runtime error at tick ' + tick + ': ' + (e && e.message || e);
        return 'wait';
      }
    }

    function spawnOrbs(tick) {
      if (orbs.length >= 4) return;
      for (var tries = 0; tries < 30; tries++) {
        var x = 1 + Math.floor(rndMap() * (COLS - 2)), y = 1 + Math.floor(rndMap() * (ROWS - 2));
        var mx = COLS - 1 - x, my = ROWS - 1 - y;
        if (blocked(x, y) || blocked(mx, my)) continue;
        if ((x === mx && y === my)) continue;
        var occupied = false;
        bots.forEach(function (b) { if ((b.x === x && b.y === y) || (b.x === mx && b.y === my)) occupied = true; });
        orbs.forEach(function (o) { if ((o.x === x && o.y === y) || (o.x === mx && o.y === my)) occupied = true; });
        if (occupied) continue;
        orbs.push({ x: x, y: y }); orbs.push({ x: mx, y: my });
        return;
      }
    }

    if (!opts.noFrames) frames.push(snapshot(0, null, null, null, []));
    var t, i;
    for (t = 1; t <= MAX_TICKS; t++) {
      var acts = [decide(0, t), decide(1, t)], ev = [], shots = [];
      // 1. rotate
      for (i = 0; i < 2; i++) {
        if (acts[i] === 'left') bots[i].dir = (bots[i].dir + 3) % 4;
        else if (acts[i] === 'right') bots[i].dir = (bots[i].dir + 1) % 4;
      }
      // 2. shields
      var sh = [false, false];
      for (i = 0; i < 2; i++) if (acts[i] === 'shield') { if (bots[i].energy >= SHIELD_COST) { bots[i].energy -= SHIELD_COST; sh[i] = true; } else { acts[i] = 'wait'; ev.push(i + ':noenergy'); } }
      // 3. movement
      var tg = [null, null];
      for (i = 0; i < 2; i++) {
        if (acts[i] !== 'forward') continue;
        var nx = bots[i].x + DX[bots[i].dir], ny = bots[i].y + DY[bots[i].dir];
        if (blocked(nx, ny)) ev.push(i + ':bump'); else tg[i] = { x: nx, y: ny };
      }
      var p0 = { x: bots[0].x, y: bots[0].y }, p1 = { x: bots[1].x, y: bots[1].y };
      function same(a, b) { return a && b && a.x === b.x && a.y === b.y; }
      if (same(tg[0], tg[1])) { tg[0] = tg[1] = null; ev.push('clash'); }
      else {
        if (tg[0] && same(tg[0], p1) && (!tg[1] || same(tg[1], p0))) tg[0] = null;
        if (tg[1] && same(tg[1], p0) && (!tg[0] || same(tg[0], p1))) tg[1] = null;
      }
      for (i = 0; i < 2; i++) if (tg[i]) { bots[i].x = tg[i].x; bots[i].y = tg[i].y; }
      // 4. shooting (rays use post-move positions; damage applied afterwards so shots are simultaneous)
      var dmg = [0, 0];
      for (i = 0; i < 2; i++) {
        if (acts[i] !== 'shoot') continue;
        if (bots[i].energy < SHOT_COST) { acts[i] = 'wait'; ev.push(i + ':noenergy'); continue; }
        bots[i].energy -= SHOT_COST;
        var o = bots[1 - i], hit = rayHits(bots[i], bots[i].dir, o.x, o.y), ex = bots[i].x, ey = bots[i].y;
        if (hit) { ex = o.x; ey = o.y; }
        else { for (;;) { var qx = ex + DX[bots[i].dir], qy = ey + DY[bots[i].dir]; if (blocked(qx, qy)) break; ex = qx; ey = qy; } }
        shots.push({ f: [bots[i].x, bots[i].y], t: [ex, ey], h: hit ? 1 : 0, by: i });
        if (hit) { dmg[1 - i] += sh[1 - i] ? DMG_SHIELDED : DMG; ev.push(i + ':hit' + (sh[1 - i] ? ':blocked' : '')); }
        else ev.push(i + ':miss');
      }
      for (i = 0; i < 2; i++) bots[i].hp = Math.max(0, bots[i].hp - dmg[i]);
      // 5. pickups
      for (i = 0; i < 2; i++) {
        for (var k = orbs.length - 1; k >= 0; k--) {
          if (orbs[k].x === bots[i].x && orbs[k].y === bots[i].y) { orbs.splice(k, 1); bots[i].hp = Math.min(HP, bots[i].hp + ORB_HEAL); ev.push(i + ':orb'); }
        }
      }
      // 6. energy regen, orb spawns
      for (i = 0; i < 2; i++) bots[i].energy = Math.min(MAX_EN, bots[i].energy + 1);
      if (t % 20 === 10) spawnOrbs(t);
      if (!opts.noFrames) frames.push(snapshot(t, acts, sh, shots, ev));
      // 7. end?
      if (bots[0].hp <= 0 || bots[1].hp <= 0) {
        if (bots[0].hp <= 0 && bots[1].hp <= 0) { winner = -1; reason = 'Double knock-out'; }
        else { winner = bots[0].hp <= 0 ? 1 : 0; reason = 'Knock-out'; }
        break;
      }
    }
    if (t > MAX_TICKS) {
      if (bots[0].hp !== bots[1].hp) { winner = bots[0].hp > bots[1].hp ? 0 : 1; reason = 'Time up: more HP wins'; }
      else { winner = -1; reason = 'Time up: equal HP'; }
    }
    return {
      winner: winner, reason: reason, ticks: Math.min(t, MAX_TICKS), errors: errors, seed: seed,
      walls: walls, cols: COLS, rows: ROWS, frames: frames, hp: [bots[0].hp, bots[1].hp]
    };
  }

  // Many matches, summary only (used by the tournament).
  function runBatch(codeA, codeB, seeds) {
    var out = { wins: 0, losses: 0, draws: 0, errA: null, errB: null };
    seeds.forEach(function (sd) {
      [false, true].forEach(function (swap) {
        var r = swap ? runMatch(codeB, codeA, sd, { noFrames: true }) : runMatch(codeA, codeB, sd, { noFrames: true });
        var mine = swap ? 1 : 0;
        if (r.winner === -1) out.draws++; else if (r.winner === mine) out.wins++; else out.losses++;
        out.errA = out.errA || r.errors[swap ? 1 : 0]; out.errB = out.errB || r.errors[swap ? 0 : 1];
      });
    });
    return out;
  }

  return { runMatch: runMatch, runBatch: runBatch, makeArena: makeArena, COLS: COLS, ROWS: ROWS, MAX_TICKS: MAX_TICKS };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ArenaEngineFactory: ArenaEngineFactory };
else if (typeof window !== 'undefined') window.ArenaEngineFactory = ArenaEngineFactory;
