const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const nodes = new Map();
const document = {
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {innerHTML: '', value: '', style: {}});
    return nodes.get(id);
  },
};
const sandbox = {
  document, structuredClone, setTimeout, clearTimeout,
  location: {hash: ''},
  window: {addEventListener() {}, scrollTo() {}},
  localStorage: {getItem: () => null, setItem() {}},
};
vm.createContext(sandbox);
for (const file of ['hero-data.js', 'hero-ui.js', 'hh-boards.js', 'published-matches.js', 'app.js']) {
  vm.runInContext(fs.readFileSync('dist/' + file, 'utf8'), sandbox);
}

function evaluate(source) {
  return vm.runInContext(source, sandbox);
}

assert.equal(evaluate('state.matches.length'), 0);
assert.equal(evaluate("findHero('敌法').slug"), 'antimage');
assert(evaluate("heroPortrait('敌法').includes('data:image/webp;base64,')"));
evaluate(`
const fixture = ['p20', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'].map((pid, index) =>
  ({pid, nickname: '测试玩家' + index, hero:'敌法师', kills:index, deaths:index, assists:index, gold:index})
);
state.matches.push({id:'1000000000', date:'2026-01-01T12:00', radiant:10, dire:5, duration:'31:05',
  winner:'radiant', mode:'随机征召', players:fixture});
mergeWuxin(state);
`);
assert.equal(evaluate("stats().find(p => p.pid === 'p1').wins"), 1);
assert.equal(evaluate("displayName(stats().find(p => p.pid === 'p1'))"), '无心');
assert.equal(evaluate("orderPlayers(stats(), 'd')[0].d"), 9);
assert.equal(evaluate("orderPlayers(stats(), 'rate')[0].rate"), 100);
assert.equal(evaluate("hhLeaderboards(state.matches).teammates.length"), 4);
assert.equal(evaluate("hhLeaderboards(state.matches).opponents.length"), 5);
assert.equal(evaluate("boardOrder.get('hh-fans')"), 'rate');
for (const route of ['home', 'ranking', 'matches', 'players', 'player/p1', 'match/1000000000']) {
  evaluate('location.hash = ' + JSON.stringify('#' + route) + '; render()');
  assert(document.getElementById('app').innerHTML);
}
console.log('PASS: empty startup, synthetic match, merge, ranking, board defaults, portraits and routes');
