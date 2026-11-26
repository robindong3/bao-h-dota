const HH_PLAYER_ID = "p4";
const boardOrder = new Map([["hh-fans", "rate"], ["hh-opponents", "rate"]]);
const rankingSortOptions = [
  ["games", "盘数"], ["wins", "胜场"], ["losses", "负场"], ["rate", "胜率"],
  ["k", "击杀"], ["d", "死亡"], ["a", "助攻"], ["kda", "KDA"],
  ["name", "玩家昵称"], ["claimed", "档案状态"],
];

const rankValues = {
  games: player => player.games,
  wins: player => player.wins,
  losses: player => player.games - player.wins,
  k: player => player.k,
  d: player => player.d,
  a: player => player.a,
  kda: player => Number(player.kda),
  claimed: player => Number(Object.hasOwn(state.bindings, player.pid)),
};

function orderPlayers(players, order) {
  const measure = rankValues[order] || rankValues.games;
  return [...players].sort((a, b) => {
    const byName = displayName(a).localeCompare(displayName(b), "zh-CN");
    if (order === "name") return byName;
    const byGames = b.games - a.games;
    const byRate = b.wins * a.games - a.wins * b.games;
    const byMetric = order === "rate" ? byRate : measure(b) - measure(a);
    return byMetric || byGames || byRate || byName;
  });
}

function boardSortSelect(id, title) {
  const options = id === "ranking" ? rankingSortOptions : [["rate", "成功率"], ["games", "盘数"]];
  const selected = boardOrder.get(id) ?? "games";
  return `<select class="board-sort" aria-label="${title}排序" data-board="${id}" onchange="changeBoardOrder(this)">
    ${options.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>按${label}</option>`).join("")}
  </select>`;
}

function changeBoardOrder(select) {
  const id = select.dataset.board;
  boardOrder.set(id, select.value);
  if (id === "ranking") {
    document.getElementById("ranking-rows").innerHTML = rankingRows();
    return;
  }
  const { teammates, opponents } = hhLeaderboards(state.matches);
  const isFans = id === "hh-fans";
  document.getElementById(id + "-rows").innerHTML = hhBoardRows(isFans ? teammates : opponents, isFans ? "保h" : "爽h", id);
}

function hhLeaderboards(matches) {
  const teammates = new Map();
  const opponents = new Map();
  for (const match of matches) {
    const hhIndex = match.players.findIndex(player => player.pid === HH_PLAYER_ID);
    if (hhIndex < 0) continue;
    match.players.forEach((player, index) => {
      if (player.pid === HH_PLAYER_ID) return;
      const board = (index < 5) === (hhIndex < 5) ? teammates : opponents;
      const entry = board.get(player.pid) ?? { ...player, games: 0, wins: 0 };
      entry.games++;
      if ((index < 5 ? "radiant" : "dire") === match.winner) entry.wins++;
      board.set(player.pid, entry);
    });
  }
  const withRate = board => Array.from(board.values())
    .map(player => ({ ...player, rate: Math.round(100 * player.wins / player.games) }));
  return { teammates: withRate(teammates), opponents: withRate(opponents) };
}

function hhBoardRows(players, gameLabel, id) {
  return orderPlayers(players, boardOrder.get(id)).map((player, index) => `
    <a class="rankrow" href="#player/${encodeURIComponent(player.pid)}">
      <span class="rankno">${index + 1}</span>
      ${avatar(player)}
      <div class="name">${E(displayName(player))}<small>${gameLabel} ${player.games} 盘 · 成功 ${player.wins} 盘</small></div>
      <strong>${player.rate}%</strong>
    </a>`).join("") || '<p class="empty">暂无符合条件的对局</p>';
}

function hhBoard(title, players, gameLabel, id) {
  return `<section aria-labelledby="${id}">
    <div class="sectionhead"><h2 id="${id}">${title}</h2>${boardSortSelect(id, title)}</div>
    <div class="panel hh-board">
      <div class="hh-board-caption"><span>成功率</span></div>
      <div id="${id}-rows">${hhBoardRows(players, gameLabel, id)}</div>
    </div>
  </section>`;
}

function hhBoards() {
  const { teammates, opponents } = hhLeaderboards(state.matches);
  return `<div class="hh-boards">
    ${hhBoard("粉头榜", teammates, "保h", "hh-fans")}
    ${hhBoard("黑子榜", opponents, "爽h", "hh-opponents")}
  </div>`;
}
