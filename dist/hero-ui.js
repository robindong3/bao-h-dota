const heroAliases = {
  '敌法': 'antimage', '火枪': 'sniper', '蓝猫': 'storm_spirit', '卡尔': 'invoker',
  '大圣': 'monkey_king', '屠夫': 'pudge', '小狗': 'life_stealer', '大鱼人': 'slardar',
  '赏金': 'bounty_hunter', '毒龙': 'viper', '骷髅王': 'skeleton_king', '骨王': 'skeleton_king',
  '死灵法师': 'necrolyte', '墨客': 'grimstroke', '影魔': 'nevermore',
};

function heroKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
    .replace(/^npc_dota_hero_/, '').replace(/[\s_.'’\-]/g, '');
}

const heroesByName = new Map();
for (const hero of DOTA_HEROES) {
  for (const value of [hero.name, hero.english, hero.slug, hero.id]) {
    if (value) heroesByName.set(heroKey(value), hero);
  }
}
for (const [alias, slug] of Object.entries(heroAliases)) {
  const hero = heroesByName.get(heroKey(slug));
  if (hero) heroesByName.set(heroKey(alias), hero);
}

function findHero(value) {
  return heroesByName.get(heroKey(value));
}

function heroPortrait(value, compact = false) {
  const hero = findHero(value);
  const label = hero?.name || value || '待确认英雄';
  const portrait = hero && (typeof DOTA_PORTRAITS === 'undefined' ? null : DOTA_PORTRAITS[hero.slug]);
  const src = portrait ? 'data:image/webp;base64,' + portrait : hero && 'heroes/' + hero.slug + '.png';
  return `<span class="hero-portrait${compact ? ' compact' : ''}" title="${E(label)}">${hero
    ? `<img src="${src}" alt="${E(label)}" loading="lazy" decoding="async">`
    : '<span aria-label="待确认英雄" role="img">?</span>'}</span>`;
}

function heroLineup(match) {
  return `<div class="hero-lineup">${[0, 1].map(team => `<div class="hero-team" aria-label="${team ? '夜魇英雄' : '天辉英雄'}">${match.players.slice(team * 5, team * 5 + 5).map(player => heroPortrait(player.hero, true)).join('')}</div>`).join('')}</div>`;
}

function reviewHeroInput(player, index) {
  return `<td><div class="review-hero">${heroPortrait(player.hero)}<input aria-label="第 ${index + 1} 人英雄" name="${index}_hero" list="hero-options" maxlength="60" required value="${E(player.hero)}" oninput="previewHero(this)"></div></td>`;
}

function previewHero(input) {
  input.previousElementSibling.outerHTML = heroPortrait(input.value);
}

function knownScreenshot(hash) {
  return state.matches.find(match => (match.sourceHash === hash || match.id === SAMPLE_SCREENSHOTS[hash]))
    || null;
}

function reviewPlayerInput(player, index) {
  const options = stats().map(profile => {
    const id = state.bindings[profile.pid]?.dotaId;
    const label = `${displayName(profile)} · ${id || profile.pid}`;
    return `<option value="${E(profile.pid)}" ${profile.pid === player.pid ? 'selected' : ''}>${E(label)}</option>`;
  }).join('');
  return `<td><select aria-label="第 ${index + 1} 人关联档案" name="${index}_pid"><option value="">新档案</option>${options}</select></td>`;
}
