// Sanity tests for the Arena engine.  Run: node test/engine.test.js
const { ArenaEngineFactory } = require('../engine.js');
const P = require('../presets.js');
const E = ArenaEngineFactory();
let fails = 0;
const check = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  → ' + x : '')); if (!c) fails++; };

// 1. every preset compiles and runs against every other without errors
P.BOTS.forEach((a) => P.BOTS.forEach((b) => {
  const r = E.runMatch(a.code, b.code, 3);
  check(a.id + ' vs ' + b.id + ' runs cleanly', !r.errors[0] && !r.errors[1] && r.frames.length > 1, r.errors.join('|'));
}));

// 2. starter code and rule-builder default code run
let r = E.runMatch(P.STARTER, P.BOTS[1].code, 5);
check('STARTER runs', !r.errors[0], r.errors[0]);
const gen = P.rulesToCode(P.DEFAULT_RULES, P.DEFAULT_DEFAULT);
r = E.runMatch(gen, P.BOTS[0].code, 5);
check('Rule-builder code runs', !r.errors[0], r.errors[0]);

// 3. determinism
const a1 = JSON.stringify(E.runMatch(P.BOTS[0].code, P.BOTS[3].code, 11).frames);
const a2 = JSON.stringify(E.runMatch(P.BOTS[0].code, P.BOTS[3].code, 11).frames);
check('same seed => identical replay', a1 === a2);

// 4. error handling
r = E.runMatch('function think(s){ throw new Error("boom"); }', P.BOTS[0].code, 1);
check('runtime error reported, game continues', /boom/.test(r.errors[0] || '') && r.frames.length > 5, r.errors[0]);
r = E.runMatch('function think(s){ return "dance"; }', P.BOTS[0].code, 1);
check('invalid action reported', /dance/.test(r.errors[0] || ''), r.errors[0]);
r = E.runMatch('var x = ;', P.BOTS[0].code, 1);
check('syntax error reported', /Syntax/.test(r.errors[0] || ''), r.errors[0]);
r = E.runMatch('var y = 1;', P.BOTS[0].code, 1);
check('missing think() reported', /function think/.test(r.errors[0] || ''), r.errors[0]);

// 5. maps are symmetric and spawn-connected, for many seeds
let symOk = true;
for (let sd = 1; sd <= 200; sd++) {
  const w = E.makeArena(sd);
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) if (w[y][x] !== w[14 - y][14 - x]) symOk = false;
  if (w[1][1] || w[13][13]) symOk = false;
}
check('200 maps symmetric, spawns open', symOk);

// 6. rules: hp can't go negative, energy bounded, no bot inside a wall
let invariants = true;
for (let sd = 1; sd <= 30; sd++) {
  const m = E.runMatch(P.BOTS[1].code, P.BOTS[2].code, sd);
  m.frames.forEach((f) => f.b.forEach((b) => {
    if (b.hp < 0 || b.hp > 100 || b.en < 0 || b.en > 10 || m.walls[b.y][b.x]) invariants = false;
  }));
  if (m.frames[m.frames.length - 1].b[0].x === m.frames[m.frames.length - 1].b[1].x && m.frames[m.frames.length - 1].b[0].y === m.frames[m.frames.length - 1].b[1].y) invariants = false;
}
check('invariants hold over 30 matches', invariants);

// 7. strength ladder (informational + loose sanity)
console.log('\nWin/Loss/Draw of row vs column over 20 seeds x 2 sides:');
const ids = P.BOTS.map((b) => b.id);
const tab = {};
P.BOTS.forEach((a) => { tab[a.id] = {}; P.BOTS.forEach((b) => {
  if (a === b) return;
  const s = E.runBatch(a.code, b.code, Array.from({ length: 20 }, (_, i) => i + 1));
  tab[a.id][b.id] = s.wins + '-' + s.losses + '-' + s.draws;
}); });
console.table(tab);
const hr = E.runBatch(P.BOTS[1].code, P.BOTS[0].code, Array.from({ length: 20 }, (_, i) => i + 1));
check('Hunter beats Rookie most of the time', hr.wins > hr.losses * 2, JSON.stringify(hr));

// 8. speed
const t0 = Date.now();
E.runBatch(P.BOTS[4].code, P.BOTS[3].code, Array.from({ length: 25 }, (_, i) => i + 1));
check('50 matches finish quickly', Date.now() - t0 < 5000, (Date.now() - t0) + ' ms');

console.log(fails ? '\n' + fails + ' FAILED' : '\nEngine verified.');
process.exit(fails ? 1 : 0);
