/* Algorithm Arena — starter code and built-in opponents. */
(function (root) {
  'use strict';

  var STARTER = [
    '// ===== Your strategy =====',
    '// think(s) runs once per tick and must RETURN one action:',
    '//   "forward" | "left" | "right" | "shoot" | "shield" | "wait"',
    '//',
    '// s.me / s.enemy  -> { x, y, dir, hp, energy }   (dir: 0=N 1=E 2=S 3=W)',
    '// s.enemyInSight  -> true if you are facing the enemy with a clear line',
    '// s.enemyAimingAtMe, s.wallAhead, s.nearestOrb ({x,y,d} or null)',
    '// s.stepToward(x,y) / s.stepAway(x,y) / s.aimAt(x,y) -> ready-made moves',
    '// s.memory is an object you can use to remember things between ticks.',
    '',
    'function think(s) {',
    '  // 1. Shoot when we can hit (shooting costs 3 energy)',
    '  if (s.enemyInSight && s.me.energy >= 3) return "shoot";',
    '',
    '  // 2. If the enemy is aiming at us, raise the shield',
    '  if (s.enemyAimingAtMe && s.me.energy >= 1) return "shield";',
    '',
    '  // 3. Low health? Grab a repair orb if one is close',
    '  if (s.me.hp < 50 && s.nearestOrb && s.nearestOrb.d < 8) {',
    '    return s.stepToward(s.nearestOrb.x, s.nearestOrb.y);',
    '  }',
    '',
    '  // 4. Otherwise hunt the enemy',
    '  return s.stepToward(s.enemy.x, s.enemy.y);',
    '}'
  ].join('\n');

  var BOTS = [
    {
      id: 'rookie', name: 'Rookie', level: 'Easy', blurb: 'Wanders randomly and shoots if you happen to be in front of it.',
      code: [
        '// Rookie: wanders randomly, shoots when it happens to see you.',
        'function think(s) {',
        '  if (s.enemyInSight && s.me.energy >= 3) return "shoot";',
        '  if (s.wallAhead) return s.random() < 0.5 ? "left" : "right";',
        '  var r = s.random();',
        '  if (r < 0.15) return "left";',
        '  if (r < 0.30) return "right";',
        '  return "forward";',
        '}'
      ].join('\n')
    },
    {
      id: 'hunter', name: 'Hunter', level: 'Medium', blurb: 'Walks the shortest path to you and fires whenever you are in line.',
      code: [
        '// Hunter: chase with BFS path-finding, shoot on sight.',
        'function think(s) {',
        '  if (s.enemyInSight && s.me.energy >= 3) return "shoot";',
        '  return s.stepToward(s.enemy.x, s.enemy.y);',
        '}'
      ].join('\n')
    },
    {
      id: 'sniper', name: 'Sniper', level: 'Medium', blurb: 'Camps at its spawn, spins to find you, turns to track you and shields when aimed at.',
      code: [
        '// Sniper: stay put, rotate to track the enemy, shoot, shield.',
        'function think(s) {',
        '  var en = s.enemy;',
        '  if (s.enemyInSight && s.me.energy >= 3) return "shoot";',
        '  var aim = s.aimAt(en.x, en.y);',
        '  if (aim && aim !== "shoot") return aim;',
        '  if (s.enemyAimingAtMe && s.me.energy >= 1) return "shield";',
        '  if (s.me.hp < 60 && s.nearestOrb && s.nearestOrb.d < 5) return s.stepToward(s.nearestOrb.x, s.nearestOrb.y);',
        '  return "right"; // spin and scan',
        '}'
      ].join('\n')
    },
    {
      id: 'turtle', name: 'Turtle', level: 'Hard', blurb: 'Defensive: shields when targeted, collects orbs, keeps its distance and counter-shoots.',
      code: [
        '// Turtle: defend, heal, keep distance, punish.',
        'function think(s) {',
        '  var me = s.me, en = s.enemy;',
        '  if (s.enemyInSight && me.energy >= 3) return "shoot";',
        '  if (s.enemyAimingAtMe && me.energy >= 1) return "shield";',
        '  if (s.nearestOrb && me.hp < 100 && s.nearestOrb.d < 10) return s.stepToward(s.nearestOrb.x, s.nearestOrb.y);',
        '  var aim = s.aimAt(en.x, en.y);',
        '  if (aim) return aim;',
        '  if (s.dist(me, en) < 6) return s.stepAway(en.x, en.y);',
        '  return "wait";',
        '}'
      ].join('\n')
    },
    {
      id: 'tactician', name: 'Tactician', level: 'Boss', blurb: 'Hunts like the Hunter but shields when targeted, heals when hurt and lines up shots.',
      code: [
        '// Tactician: hunt + shield + heal + line up shots.',
        'function think(s) {',
        '  var me = s.me, en = s.enemy, orb = s.nearestOrb;',
        '  if (s.enemyInSight && me.energy >= 3) return "shoot";',
        '  var aim = s.aimAt(en.x, en.y);',
        '  if (s.enemyAimingAtMe) {',
        '    if (aim && aim !== "shoot" && me.energy >= 3) return aim; // turn to face them, then fire',
        '    if (me.energy < 3) {                 // alternate shield / recharge so energy can climb back',
        '      s.memory.flip = !s.memory.flip;',
        '      return s.memory.flip ? "shield" : "wait";',
        '    }',
        '    return "shield";',
        '  }',
        '  if (me.hp < 60 && orb && orb.d < 9) return s.stepToward(orb.x, orb.y);',
        '  if (aim && aim !== "shoot") return aim;',
        '  return s.stepToward(en.x, en.y);',
        '}'
      ].join('\n')
    }
  ];

  /* ---------- rule builder -> code ---------- */
  var CONDITIONS = [
    { id: 'sight',   label: 'enemy is in my line of fire', code: function () { return 's.enemyInSight'; } },
    { id: 'aimed',   label: 'enemy is aiming at me',       code: function () { return 's.enemyAimingAtMe'; } },
    { id: 'aligned', label: 'enemy is in line with me (row/col)', code: function () { return '(s.me.x === s.enemy.x || s.me.y === s.enemy.y)'; } },
    { id: 'wall',    label: 'wall right ahead',            code: function () { return 's.wallAhead'; } },
    { id: 'energyGE', label: 'my energy ≥', n: 3,          code: function (n) { return 's.me.energy >= ' + n; } },
    { id: 'hpLT',    label: 'my HP <', n: 50,              code: function (n) { return 's.me.hp < ' + n; } },
    { id: 'enemyHpLT', label: 'enemy HP <', n: 40,         code: function (n) { return 's.enemy.hp < ' + n; } },
    { id: 'distLT',  label: 'distance to enemy <', n: 5,    code: function (n) { return 's.dist(s.me, s.enemy) < ' + n; } },
    { id: 'distGT',  label: 'distance to enemy >', n: 8,    code: function (n) { return 's.dist(s.me, s.enemy) > ' + n; } },
    { id: 'orbNear', label: 'a repair orb is within (steps)', n: 8, code: function (n) { return '(s.nearestOrb && s.nearestOrb.d < ' + n + ')'; } },
    { id: 'chance',  label: 'random chance (%)', n: 20,     code: function (n) { return 's.random() < ' + (n / 100); } },
    { id: 'always',  label: 'always',                      code: function () { return 'true'; } }
  ];
  var ACTS = [
    { id: 'shoot',   label: 'shoot',                  code: '"shoot"' },
    { id: 'shield',  label: 'shield',                 code: '"shield"' },
    { id: 'forward', label: 'move forward',           code: '"forward"' },
    { id: 'left',    label: 'turn left',              code: '"left"' },
    { id: 'right',   label: 'turn right',             code: '"right"' },
    { id: 'wait',    label: 'wait (recharge)',        code: '"wait"' },
    { id: 'chase',   label: 'chase the enemy',        code: 's.stepToward(s.enemy.x, s.enemy.y)' },
    { id: 'flee',    label: 'run away from enemy',    code: 's.stepAway(s.enemy.x, s.enemy.y)' },
    { id: 'orb',     label: 'go to nearest repair orb', code: 's.nearestOrb ? s.stepToward(s.nearestOrb.x, s.nearestOrb.y) : "wait"' },
    { id: 'aim',     label: 'turn towards enemy',     code: '(s.aimAt(s.enemy.x, s.enemy.y) || "wait")' }
  ];
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }

  function condCode(c) { if (!c) return null; var d = byId(CONDITIONS, c.id); return d.code(Number(c.n) || 0); }

  // rules: [{c1:{id,n}, c2:{id,n}|null, act}], def: action id
  function rulesToCode(rules, def) {
    var out = ['// Generated by the Rule Builder (you can edit it in the code tab).', 'function think(s) {'];
    rules.forEach(function (r) {
      var parts = [condCode(r.c1), condCode(r.c2)].filter(Boolean);
      out.push('  if (' + (parts.join(' && ') || 'true') + ') return ' + byId(ACTS, r.act).code + ';');
    });
    out.push('  return ' + byId(ACTS, def).code + ';', '}');
    return out.join('\n');
  }
  var DEFAULT_RULES = [
    { c1: { id: 'sight', n: 0 }, c2: { id: 'energyGE', n: 3 }, act: 'shoot' },
    { c1: { id: 'aimed', n: 0 }, c2: { id: 'energyGE', n: 1 }, act: 'shield' },
    { c1: { id: 'hpLT', n: 50 }, c2: { id: 'orbNear', n: 8 }, act: 'orb' },
    { c1: { id: 'aligned', n: 0 }, c2: null, act: 'aim' }
  ];

  var api = { STARTER: STARTER, BOTS: BOTS, CONDITIONS: CONDITIONS, ACTS: ACTS, rulesToCode: rulesToCode, DEFAULT_RULES: DEFAULT_RULES, DEFAULT_DEFAULT: 'chase' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaPresets = api;
})(typeof window !== 'undefined' ? window : globalThis);
