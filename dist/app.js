const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seeds = [];
const PUBLISHED_BATCH = 'source-release';

function newestFirst(matches) {
  return matches.sort((a, b) => b.date.localeCompare(a.date));
}

function initialState() {
  const saved = { matches: newestFirst(structuredClone([...seeds, ...PUBLISHED_MATCHES])),
    claims: [], bindings: {}, importedBatches: [PUBLISHED_BATCH] };
  mergeWuxin(saved);
  return saved;
}

function mergeWuxin(saved) {
  let changed = false;
  for (const match of saved.matches) {
    // Preserve both slots if a manually entered match already contains these two profiles.
    if (match.players.some(player => player.pid === 'p1')) continue;
    for (const player of match.players) {
      if (player.pid !== 'p20') continue;
      player.pid = 'p1';
      changed = true;
    }
  }
  if (saved.bindings.p20) {
    saved.bindings.p1 ??= saved.bindings.p20;
    delete saved.bindings.p20;
    changed = true;
  }
  for (const claim of saved.claims) {
    if (claim.pid !== 'p20') continue;
    claim.pid = 'p1';
    changed = true;
  }
  return changed;
}

function normalizedDotaId(id) {
  return String(id ?? '').trim().replace(/^0+(?=\d)/, '');
}

function claimConflict(bindings, pid, dotaId) {
  if (Object.hasOwn(bindings, pid)) return '这份档案已被认领。';
  if (Object.values(bindings).some(binding => normalizedDotaId(binding.dotaId) === dotaId)) {
    return '此 Dota ID 已绑定其他档案。';
  }
  return '';
}

function restoreState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('inhouse-demo-v1')); } catch {}
  if (!saved || !Array.isArray(saved.matches)) return initialState();
  const batches = Array.isArray(saved.importedBatches) ? saved.importedBatches : [];
  let changed = !batches.includes(PUBLISHED_BATCH);
  if (changed) {
    const existingIds = new Set(saved.matches.map(match => String(match.id)));
    const additions = PUBLISHED_MATCHES.filter(match => !existingIds.has(match.id));
    saved.matches = newestFirst([...saved.matches, ...structuredClone(additions)]);
    saved.importedBatches = [...batches, PUBLISHED_BATCH];
  }
  saved.bindings ??= {};
  saved.claims ??= [];
  if (mergeWuxin(saved)) changed = true;
  const pids = new Set(saved.matches.flatMap(match => match.players.map(player => player.pid)));
  for (const claim of saved.claims) {
    if (claim.status !== 'pending' || !pids.has(claim.pid) || !claim.display?.trim()) continue;
    const dotaId = normalizedDotaId(claim.dotaId);
    if (!/^[0-9]{1,10}$/.test(dotaId)) continue;
    const conflict = claimConflict(saved.bindings, claim.pid, dotaId);
    claim.status = conflict ? 'rejected' : 'approved';
    if (!conflict) saved.bindings[claim.pid] = {display: claim.display.trim(), dotaId};
    changed = true;
  }
  if (changed) {
    try { localStorage.setItem('inhouse-demo-v1', JSON.stringify(saved)); } catch {}
  }
  return saved;
}

let state = restoreState();
let draft=null,uploadImage=null,uploadHash=null,uploadVersion=0,uploadBusy=false;const app=document.getElementById('app');
let uploadJob = null;
let recognitionOrigin = '';
function persist(){try{localStorage.setItem('inhouse-demo-v1',JSON.stringify(state));return true}catch{toast('浏览器存储空间不足，请导出备份后再录入');return false}}
function toast(t){const x=document.getElementById('toast');x.textContent=t;x.style.display='block';clearTimeout(window.tt);window.tt=setTimeout(()=>x.style.display='none',4500)}
function stats(){const map={};state.matches.forEach(m=>m.players.forEach((p,i)=>{const s=map[p.pid]??={...p,games:0,wins:0,k:0,d:0,a:0};s.games++;s.wins+=((i<5?'radiant':'dire')===m.winner)?1:0;s.k+=+p.kills;s.d+=+p.deaths;s.a+=+p.assists}));return Object.values(map).map(p=>({...p,rate:Math.round(p.wins/p.games*100),kda:((p.k+p.a)/Math.max(1,p.d)).toFixed(2)})).sort((a,b)=>b.wins-a.wins||b.rate-a.rate||b.kda-a.kda)}
function matchcard(m){return `<article class="match" tabindex="0" role="button" onclick="location.hash='match/${m.id}'" onkeydown="if(event.key==='Enter')location.hash='match/${m.id}'"><div class="matchtop"><span>${E(m.date.replace('T',' '))} · ${E(m.mode)}</span><span class="badge">已入库</span></div><div class="score"><div><span class="num radiant">${m.radiant}</span><label>天辉</label></div><span class="vs">${E(m.duration)}<br>—</span><div><span class="num dire">${m.dire}</span><label>${m.winner==='dire'?'夜魇胜利':'夜魇'}</label></div></div>${heroLineup(m)}<div class="matchbottom"><span>#${E(m.id)}</span><span>10 位玩家 · 截图录入 <span class="good">↗</span></span></div></article>`}
function displayName(player) {
  const claimed = state.bindings[player.pid]?.display?.trim();
  if (player.pid === 'p1' && (!claimed || claimed.toLowerCase() === 'xin')) return '无心';
  return claimed || player.nickname;
}
function avatar(p){return `<span class="avatar">${E(Array.from(displayName(p))[0])}</span>`}
function metrics(){const ss=stats();return `<div class="stats summary-stats"><div class="stat"><label>已记录对局</label><strong>${state.matches.length.toString().padStart(2,'0')}</strong><small>每场只计入一次</small></div><div class="stat"><label>参战玩家</label><strong>${ss.length}</strong><small>包含尚未认领档案</small></div><div class="stat"><label>夜魇胜率</label><strong>${Math.round(state.matches.filter(m=>m.winner==='dire').length/Math.max(1,state.matches.length)*100)}<span style="font-size:17px">%</span></strong><small>当前已入库样本</small></div></div>`}
function home(){const ss=stats();const hh=ss.find(p=>p.pid===HH_PLAYER_ID);app.innerHTML=`<div class="featured-stat"><span>保h成功率</span><strong>${hh ? hh.rate + "%" : "—"}</strong>${hh ? `<a href="#player/${hh.pid}">${E(displayName(hh))} · ${hh.wins} 胜 / ${hh.games} 场</a>` : ""}</div>${hhBoards()}${metrics()}<div class="columns"><section><div class="sectionhead"><h2>最近的交锋</h2><a href="#matches">全部对局 ↗</a></div>${[...state.matches].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3).map(matchcard).join('')}</section><section><div class="sectionhead"><h2>本期胜场榜</h2><a href="#ranking">查看排名 ↗</a></div><div class="panel">${ss.slice(0,5).map((p,i)=>`<div class="rankrow" onclick="location.hash='player/${p.pid}'"><span class="rankno">${i+1}</span>${avatar(p)}<div class="name">${E(displayName(p))}<small>${p.games} 场 · ${p.wins} 胜</small></div><strong>${p.rate}%</strong></div>`).join('')}<p class="note">按胜场、胜率、KDA 排序。</p></div></section></div>`}
function matches(){app.innerHTML=`<h1>所有对局</h1><p class="lead">每一场阵容、每一次翻盘，都有迹可循。</p><div class="filters"><input type="search" id="query" placeholder="搜索比赛 ID、玩家昵称或英雄" aria-label="搜索比赛"><select id="mode" aria-label="游戏模式"><option value="">全部模式</option><option>随机征召</option><option>全英雄选择</option></select></div><div class="gridmatches" id="matchlist"></div>`;const draw=()=>{const q=document.getElementById('query').value.toLowerCase(),mode=document.getElementById('mode').value;const list=state.matches.filter(m=>(!mode||m.mode===mode)&&(m.id.includes(q)||m.players.some(p=>[p.nickname,displayName(p),p.pid==='p1'?'xin':'',p.hero].join(" ").toLowerCase().includes(q))));document.getElementById('matchlist').innerHTML=list.map(matchcard).join('')||'<div class="empty">没有找到符合条件的对局。</div>'};document.getElementById('query').oninput=draw;document.getElementById('mode').onchange=draw;draw()}
function rankingRows(){return orderPlayers(stats(), boardOrder.get("ranking")).map((p,i)=>`<tr><td class="playerlink" onclick="location.hash='player/${p.pid}'">${i+1}　${E(displayName(p))}</td><td>${p.games}</td><td>${p.wins} / ${p.games-p.wins}</td><td>${p.rate}%<div class="winbar"><i style="width:${p.rate}%"></i></div></td><td>${p.k} / ${p.d} / ${p.a}</td><td>${p.kda}</td><td>${state.bindings[p.pid]?'<span class="good">已认领</span>':'<span class="pill">待认领</span>'}</td></tr>`).join('')}
function ranking(){app.innerHTML=`<h1>群友排行榜</h1><p class="lead">赢得漂亮，也记得一起输过的那些局。</p>${metrics()}<div class="ranking-sort">${boardSortSelect("ranking", "群友排行榜")}</div><div class="tablewrap"><table><thead><tr><th>排名 / 玩家</th><th>场次</th><th>胜 / 负</th><th>胜率</th><th>击杀 / 死亡 / 助攻</th><th>KDA</th><th>档案状态</th></tr></thead><tbody id="ranking-rows">${rankingRows()}</tbody></table></div><p class="note">KDA =（总击杀 + 总助攻）÷ max(1, 总死亡)。只统计已确认对局；不把英雄等级或 Dota Plus 徽章当作玩家段位。</p>`}
function detail(id){const m=state.matches.find(m=>m.id===id);if(!m){app.innerHTML='<p>对局不存在。</p>';return}app.innerHTML=`<a class="back" href="#matches">‹ 返回所有对局</a><h1>对局 #${E(m.id)}</h1><p class="lead">${E(m.date.replace('T',' '))} · ${E(m.mode)} · 截图录入</p><div class="panel detailscore"><div class="radiant">天辉<strong>${m.radiant}</strong></div><div><span class="${m.winner==='dire'?'dire':'radiant'}">${m.winner==='dire'?'夜魇':'天辉'}胜利</span><small>比赛时长 ${E(m.duration)}</small></div><div class="dire">夜魇<strong>${m.dire}</strong></div></div><div class="tabs"><button class="on" id="tabstats" onclick="detailTab(false)">计分板</button><button id="tabsource" onclick="detailTab(true)">原始截图</button></div><div id="board"><div class="twoteams">${[0,1].map(team=>`<section><div class="teamtitle ${team?'red':''}">${team?'夜魇':'天辉'} ${m.winner===(team?'dire':'radiant')?'· 胜利':''}</div><div class="tablewrap"><table class="teamtable"><thead><tr><th>玩家 / 英雄</th><th>击杀 / 死亡 / 助攻</th><th>净资产</th></tr></thead><tbody>${m.players.slice(team*5,team*5+5).map(p=>`<tr><td class="playerlink" onclick="location.hash='player/${p.pid}'"><div class="heroexcerpt">${heroPortrait(p.hero)}<div>${E(displayName(p))}<br><span class="subtle">${E(findHero(p.hero)?.name || p.hero || '英雄待校对')}</span></div></div></td><td>${p.kills} / ${p.deaths} / ${p.assists}</td><td>${Number(p.gold).toLocaleString()}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div><p class="note">来源：用户截图人工整理，英雄与特殊字符昵称可校对。团队比分与玩家击杀合计可能不同，保留截图原值；截图昵称合并仅为演示映射，尚未验证真实账号身份。</p></div><div id="source" hidden><img class="sourceimage" src="${E(m.source)}" alt="比赛 ${E(m.id)} 原始结算截图"></div><div class="actions"><button onclick="editMatch('${m.id}')">校对这场数据</button><button class="danger secondary" onclick="deleteMatch('${m.id}')">移出统计</button></div>`}
function detailTab(source){document.getElementById('board').hidden=source;document.getElementById('source').hidden=!source;document.getElementById('tabstats').className=source?'':'on';document.getElementById('tabsource').className=source?'on':''}
function players(){app.innerHTML=`<h1>群友档案</h1><p class="lead">提交群内昵称和 Dota 好友 ID，即可认领档案。</p><div class="filters"><input id="pquery" type="search" placeholder="搜索昵称或已认领 Dota ID" aria-label="搜索玩家"></div><div class="playercards" id="plist"></div><p class="note">认领记录保存在当前浏览器。</p>`;const draw=()=>{const q=document.getElementById('pquery').value.toLowerCase();document.getElementById('plist').innerHTML=stats().filter(p=>[p.nickname,displayName(p),p.pid==='p1'?'xin':'',state.bindings[p.pid]?.dotaId].join(' ').toLowerCase().includes(q)).map(p=>`<article class="playercard"><div class="cardtop">${avatar(p)}<div><h3><a href="#player/${p.pid}">${E(displayName(p))}</a></h3><small>${state.bindings[p.pid]?'已认领':'未认领 · 临时玩家档案'}</small></div></div><div class="cardstats"><div><strong>${p.games}</strong><label>参战场次</label></div><div><strong>${p.rate}%</strong><label>胜率</label></div><div><strong>${p.kda}</strong><label>KDA</label></div></div><button onclick="claim('${p.pid}')" ${state.bindings[p.pid]?'disabled':''}>${state.bindings[p.pid]?'档案已认领':'这是我，认领档案'}</button></article>`).join('')||'<p>没有找到玩家。</p>'};document.getElementById('pquery').oninput=draw;draw()}
function profile(pid){if(pid==='p20')pid='p1';const p=stats().find(p=>p.pid===pid);if(!p){app.innerHTML='<p>玩家不存在。</p>';return}const list=state.matches.filter(m=>m.players.some(x=>x.pid===pid));app.innerHTML=`<a class="back" href="#players">‹ 返回群友档案</a><div class="profilehead">${avatar(p)}<div><h1>${E(displayName(p))}</h1><span class="subtle">${state.bindings[pid]?'已认领 · Dota ID '+E(state.bindings[pid].dotaId):'临时档案 · 等待本人认领'}</span></div></div><div class="stats"><div class="stat"><label>总场次</label><strong>${p.games}</strong></div><div class="stat"><label>胜率</label><strong>${p.rate}%</strong></div><div class="stat"><label>KDA</label><strong>${p.kda}</strong></div><div class="stat"><label>击杀 / 死亡 / 助攻</label><strong>${p.k} / ${p.d} / ${p.a}</strong></div></div><div class="sectionhead"><h2>参与的对局</h2><button onclick="claim('${pid}')" ${state.bindings[pid]?'disabled':''}>认领档案</button></div><div class="gridmatches">${list.map(matchcard).join('')}</div>`}
function claim(pid) {
  const player = stats().find(player => player.pid === pid);
  if (!player || state.bindings[pid]) return;
  const modal = document.getElementById('modal');
  modal.innerHTML = `<button class="close" onclick="this.closest('dialog').close()" aria-label="关闭">×</button>
    <h2>认领 ${E(displayName(player))}</h2>
    <form id="claimform">
      <label for="display">群内昵称</label><input id="display" required maxlength="40">
      <label for="dotaid">Dota 好友 ID（数字）</label><input id="dotaid" inputmode="numeric" pattern="[0-9]{1,10}" required>
      <div class="actions"><button type="submit" class="primary">确认认领</button></div>
    </form>`;
  document.getElementById('claimform').onsubmit = event => {
    event.preventDefault();
    const display = document.getElementById('display').value.trim();
    const dotaId = normalizedDotaId(document.getElementById('dotaid').value);
    if (!display || !/^[0-9]{1,10}$/.test(dotaId)) return toast('请输入群内昵称和有效的 Dota 好友 ID。');
    state = restoreState();
    const conflict = claimConflict(state.bindings, pid, dotaId);
    if (conflict) return toast(conflict);
    state.claims.push({id: Date.now(), pid, display, dotaId, status: 'approved'});
    state.bindings[pid] = {display, dotaId};
    if (!persist()) {
      state.claims.pop();
      delete state.bindings[pid];
      return;
    }
    modal.close();
    render();
    toast('认领成功');
  };
  modal.showModal();
}

function upload(){draft=null;uploadImage=null;uploadHash=null;uploadJob=null;uploadBusy=false;uploadVersion++;app.innerHTML=`<h1>上传比赛截图</h1><div class="steps"><span>① 上传截图</span><span>② 识别并校对</span><span>③ 确认入库</span></div><div class="uploadgrid"><section><div class="drop" id="drop"><div class="uploadicon">▧</div><h2>粘贴赛后结算截图</h2><p>复制截图后按 Ctrl+V（Mac 用 ⌘V），也可以拖入图片或选择文件。</p><button type="button" class="primary" id="paste" onclick="pasteClipboard()">从剪贴板上传</button> <button type="button" id="take-photo" onclick="document.getElementById('camera').click()">拍照上传</button><input id="camera" class="camera-input" type="file" accept="image/*" capture="environment" hidden><p>支持概览和计分板。登记需要比赛 ID<br>PNG / JPG / WEBP · 最大 8 MB</p><input id="file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择结算截图"><img id="preview" hidden alt="待录入的截图预览"></div><div id="upload-status" aria-live="polite"></div><div class="inlinebuttons"><button class="primary" id="ai" disabled onclick="recognize()">AI 识别截图</button><button id="manual" disabled onclick="manualDraft()">手动填写草稿</button></div><p class="note">已入库的截图无需再次上传。启用后，新的截图会由 Codex 发给 OpenAI 识别，再由你校对。</p></section><section class="panel"><h3>怎样的截图更好识别？</h3><ul class="checklist"><li>完整显示双方，共 10 位玩家</li><li>计分板没显示比赛 ID 时，从概览页补填</li><li>保留顶部胜负、比分和比赛时长</li><li>上传原图，尽量避免二次压缩</li></ul><hr style="border:0;border-top:1px solid var(--line)"><h3 style="margin-top:22px">识别后，先看一眼</h3><p class="lead">特殊符号昵称、英雄饰品可能影响识别。校对后才进入排行榜。重复比赛不会重复加分。</p></section></div><section id="import-drafts"></section><div id="review"></div>`;void showImportDrafts(uploadVersion);
  const camera=document.getElementById('camera');
  camera.onchange=()=>{const file=camera.files[0];camera.value='';void loadFile(file,true)};
  const input=document.getElementById('file');input.onchange=()=>{const file=input.files[0];input.value='';void loadFile(file)};const drop=document.getElementById('drop');drop.ondragover=e=>{e.preventDefault()};drop.ondrop=e=>{e.preventDefault();loadFile(e.dataTransfer.files[0])}}

async function showImportDrafts(version) {
  try {
    const response = await fetch('./api/import-drafts', { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
    const { drafts } = await response.json();
    if (version !== uploadVersion) return;
    const pending = drafts.filter(item => !state.matches.some(match => match.id === item.id));
    if (!pending.length) return;
    const section = document.getElementById('import-drafts');
    section.innerHTML = `<div class="sectionhead"><h2>待校对对局</h2></div><div class="inlinebuttons"></div>`;
    const buttons = section.querySelector('.inlinebuttons');
    for (const item of pending) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `#${item.id} · ${item.radiant}:${item.dire}`;
      button.onclick = () => {
        if (uploadBusy) return;
        const existing = state.matches.find(match => match.id === item.id);
        if (existing) {
          showDuplicate(existing);
          return;
        }
        uploadVersion++;
        editingId = null;
        uploadImage = item.source;
        uploadHash = null;
        const preview = document.getElementById('preview');
        preview.src = item.source;
        preview.hidden = false;
        draft = buildReviewDraft(item, item.source);
        setUploadBusy(false, '已打开草稿。校对后可以登记。');
        document.getElementById('ai').disabled = true;
        document.getElementById('manual').disabled = true;
        renderReview();
        document.getElementById('review').scrollIntoView({ behavior: 'smooth' });
      };
      buttons.append(button);
    }
  } catch {
    // The standalone static preview has no local import inbox.
  }
}

function buildReviewDraft(data, image) {
  return {
    ...data, id: data.id || '', date: data.date || '', duration: data.duration || '',
    mode: data.mode || '未识别', radiant: data.radiant ?? '', dire: data.dire ?? '',
    winner: data.winner || '', source: image,
    players: data.players.map(player => ({
      ...player, pid: /^(xin|无心)$/i.test(player.nickname?.trim()) ? 'p1' : '', nickname: player.nickname || '',
      hero: findHero(player.hero)?.name || player.hero || '',
    })),
  };
}

function showDuplicate(match) {
  document.getElementById('review').innerHTML = '';
  document.getElementById('ai').disabled = true;
  document.getElementById('manual').disabled = true;
  document.getElementById('upload-status').innerHTML =
    `<p class="note">比赛 #${E(match.id)} 已入库。 <a class="good" href="#match/${E(match.id)}">查看已有对局</a></p>`;
}

async function loadFile(file, fromCamera = false) {
  if (!file || uploadBusy) return;
  const validType = fromCamera ? (!file.type || file.type.startsWith('image/'))
    : ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
  if (!validType || file.size > (fromCamera ? 32 : 8) * 1024 * 1024) {
    toast(fromCamera ? '请拍摄小于 32 MB 的照片。' : '请选择不超过 8 MB 的 PNG、JPG 或 WEBP 图片');
    return;
  }
  const version = ++uploadVersion;
  draft = null;
  uploadImage = null;
  uploadHash = null;
  uploadJob = null;
  setUploadBusy(true, '正在检查截图…');
  document.getElementById('preview').hidden = true;
  document.getElementById('review').innerHTML = '';
  try {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (version !== uploadVersion) return;
    uploadHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const existing = knownScreenshot(uploadHash);
    if (existing) {
      setUploadBusy(false);
      showDuplicate(existing);
      return;
    }
    const bitmap = await createImageBitmap(file);
    try {
      if (version !== uploadVersion) return;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1800 / bitmap.width, 1800 / bitmap.height);
      canvas.width = Math.max(1, bitmap.width * scale);
      canvas.height = Math.max(1, bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      uploadImage = canvas.toDataURL('image/jpeg', 0.85);
    } finally {
      bitmap.close();
    }
    const preview = document.getElementById('preview');
    preview.src = uploadImage;
    preview.hidden = false;
    setUploadStatus('正在读取战绩，识别完成后可继续上传。', true);
    await recognizeSelectedImage(version);
  } catch {
    if (version === uploadVersion) {
      setUploadBusy(false);
      setUploadStatus(fromCamera ? '这张照片无法读取，请用相机的 JPEG 格式重拍，或上传相册截图。' : '图片无法处理，请换一张有效图片。');
    }
  }
}

function setUploadBusy(busy, message = '') {
  uploadBusy = busy;
  document.getElementById('file').disabled = busy;
  document.getElementById('paste').disabled = busy;
  document.getElementById('take-photo').disabled = busy;
  document.getElementById('camera').disabled = busy;
  document.getElementById('drop').setAttribute('aria-busy', String(busy));
  document.getElementById('ai').disabled = busy || !uploadImage;
  document.getElementById('manual').disabled = busy || !uploadImage;
  if (message) setUploadStatus(message, busy);
}

function setUploadStatus(message, busy = false) {
  document.getElementById('upload-status').innerHTML =
    `<p class="note upload-progress${busy ? ' pending' : ''}">${E(message)}</p>`;
}

async function recognize() {
  if (uploadBusy || !uploadImage) return;
  const version = uploadVersion;
  setUploadBusy(true, '正在读取战绩，识别完成后可继续上传。');
  await recognizeSelectedImage(version);
}

async function readRecognition(path, options = {}, timeout = 12000) {
  const fallback = 'https://bao-h-dota.pages.dev';
  const origins = location.hostname !== 'hhdota.xyz' ? [''] : recognitionOrigin ? [fallback, ''] : ['', fallback];
  for (const origin of origins) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch((origin || '.') + path, {...options, signal:controller.signal, cache:'no-store'});
      if (response.status >= 500 && origin !== origins.at(-1)) continue;
      const data = await response.json();
      recognitionOrigin = origin;
      return {response,data};
    } catch {
      if (origin === origins.at(-1)) throw new Error(uploadJob
        ? '截图已上传，暂时取不到识别结果。点击「AI 识别截图」继续查询。'
        : '连接截图服务失败，请点「AI 识别截图」重试。');
    } finally {
      clearTimeout(timer);
    }
  }
}

async function recognizeSelectedImage(version) {
  let duplicate = null;
  try {
    let result;
    if (!uploadJob) {
      const {response:health,data:service} = await readRecognition('/api/health');
      if (!health.ok) throw new Error(service.message || '暂时无法连接识别服务。');
      if (!service.queued && !service.aiConfigured) {
        throw new Error('本机 Codex 识别尚未启用，可以手动填写。');
      }
      if (version !== uploadVersion) return;
      result = await readRecognition('/api/recognize', {
        method:'POST',
        headers:{'Content-Type': service.queued ? 'image/jpeg' : 'application/json'},
        body:service.queued ? await (await fetch(uploadImage)).blob() : JSON.stringify({image:uploadImage}),
      }, service.queued ? 12000 : 160000);
      if (version !== uploadVersion) return;
      if (result.response.status === 202) uploadJob = result.data.job;
    }
    if (uploadJob) {
      const started = Date.now();
      let failures = 0;
      setUploadStatus('截图已上传，排队识别中…', true);
      do {
        if (version !== uploadVersion) return;
        try {
          result = await readRecognition('/api/recognition/' + encodeURIComponent(uploadJob));
          if (version !== uploadVersion) return;
          if (result.response.status >= 500) throw new Error(result.data.message);
          failures = 0;
          if (result.response.status !== 202) {
            uploadJob = null;
            break;
          }
        } catch (error) {
          if (++failures >= 3) throw error;
        }
        if (version !== uploadVersion) return;
        const elapsed = Math.floor((Date.now() - started) / 1000);
        if (elapsed >= 180) throw new Error('截图已上传，仍在等待识别。点击「AI 识别截图」可继续查询。');
        setUploadStatus(failures ? '连接暂时中断，正在重新查询…' : `截图已上传，等待识别结果（${elapsed} 秒）…`, true);
        await new Promise(resolve => setTimeout(resolve, 3500));
      } while (true);
    }
    if (!result?.response.ok) throw new Error(result?.data.message || '读取失败，请点「AI 识别截图」重试。');
    if (version !== uploadVersion) return;
    const d = result.data.draft;
    duplicate = state.matches.find(match => match.id === String(d.id));
    if (duplicate) return;
    draft = buildReviewDraft(d, uploadImage);
    renderReview();
    setUploadStatus(d.id ? '读取成功。可以校对这一场，或继续上传。' : '已读取阵容，请从游戏概览页补填比赛 ID 后登记。');
  } catch (error) {
    if (version === uploadVersion) setUploadStatus(error.message || '读取失败，请重试。');
  } finally {
    if (version === uploadVersion) {
      setUploadBusy(false);
      if (duplicate) showDuplicate(duplicate);
    }
  }
}
function manualDraft(){draft={id:'',date:'',duration:'',mode:'随机征召',radiant:0,dire:0,winner:'dire',source:uploadImage,players:Array.from({length:10},(_,i)=>({pid:'',nickname:'',hero:'',kills:0,deaths:0,assists:0,gold:0}))};renderReview()}
let editingId=null;
function editMatch(id){location.hash='upload';setTimeout(()=>{editingId=id;draft=structuredClone(state.matches.find(m=>m.id===id));uploadImage=draft.source;renderReview();document.getElementById('review').scrollIntoView({behavior:'smooth'})},40)}
function renderReview(){document.getElementById('review').innerHTML=`<section class="panel" style="margin-top:28px"><h2>校对对局草稿</h2><p class="note">${editingId?'正在修订已有对局，保存后会重算统计。':'相同比赛 ID 只收录一次。同一个人可以选择已有档案，方便累计胜率。同名玩家不会自动合并。'}</p><form id="reviewform"><datalist id="hero-options">${DOTA_HEROES.map(hero=>`<option value="${E(hero.name)}">`).join("")}</datalist><div class="formrow"><label class="field">比赛 ID<input name="id" required pattern="[0-9]{6,12}" value="${E(draft.id)}" ${editingId?'readonly':''}></label><label class="field">截图显示的日期时间<input type="datetime-local" name="date" required value="${E(draft.date)}"></label><label class="field">时长（分:秒或时:分:秒）<input name="duration" pattern="(?:[0-9]{1,3}|[0-9]{1,2}:[0-5][0-9]):[0-5][0-9]" required value="${E(draft.duration)}"></label><label class="field">天辉比分<input name="radiant" type="number" min="0" max="999" required value="${draft.radiant}"></label><label class="field">夜魇比分<input name="dire" type="number" min="0" max="999" required value="${draft.dire}"></label><label class="field">获胜方<select name="winner" required><option value="">请选择获胜方</option><option value="dire" ${draft.winner==='dire'?'selected':''}>夜魇</option><option value="radiant" ${draft.winner==='radiant'?'selected':''}>天辉</option></select></label></div><div class="tablewrap"><table class="reviewtable"><thead><tr><th>阵营</th><th>截图昵称</th><th>关联档案</th><th>英雄</th><th>K</th><th>D</th><th>A</th><th>净资产</th></tr></thead><tbody>${draft.players.map((p,i)=>`<tr><td>${i<5?'天辉':'夜魇'}</td>${['nickname','hero','kills','deaths','assists','gold'].map(k=>k==='hero'?reviewHeroInput(p,i):`<td><input aria-label="第 ${i+1} 人 ${k}" class="${k==='nickname'?'nick':''}" name="${i}_${k}" ${['nickname','hero'].includes(k)?'maxlength="60"':'type="number" min="0" max="999999"'} required value="${E(p[k])}"></td>${k==="nickname"?reviewPlayerInput(p,i):""}`).join('')}</tr>`).join('')}</tbody></table></div><div class="actions"><button type="submit" class="primary">${editingId?'保存校对并重算':'确认，保存对局'}</button></div></form></section>`;document.getElementById('reviewform').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),id=f.get('id');if(!editingId&&state.matches.some(m=>m.id===id)){toast('这场已入库，未重复统计。可到对局详情校对。');return}const m={...draft,id,date:f.get('date'),duration:f.get('duration'),radiant:+f.get('radiant'),dire:+f.get('dire'),winner:f.get('winner'),source:uploadImage||draft.source,sourceHash:uploadHash||draft.sourceHash};m.players=draft.players.map((p,i)=>{const x={...p};for(const k of ['nickname','hero','kills','deaths','assists','gold'])x[k]=['nickname','hero'].includes(k)?f.get(i+'_'+k).trim():+f.get(i+'_'+k);x.hero=findHero(x.hero)?.name||x.hero;x.pid=f.get(i+'_pid')||(!p.pid?'u'+id+'_'+i:'u'+id+'_new_'+i);return x});if(new Set(m.players.map(p=>p.pid)).size!==10){toast('同一玩家档案不能在一场比赛里出现两次');return}if(m.players.some(p=>!p.nickname||!p.hero)){toast('请补全玩家昵称和英雄');return}const old=state.matches;state.matches=editingId?state.matches.map(x=>x.id===editingId?m:x):[m,...state.matches];if(!persist()){state.matches=old;return}editingId=null;location.hash='match/'+id;toast('已保存，排行榜已更新')}}
function deleteMatch(id){if(!confirm('移出这场比赛？排行榜会重新计算。'))return;state.matches=state.matches.filter(m=>m.id!==id);persist();location.hash='matches';toast('已移出统计')}
function guide(){app.innerHTML=`<h1>一套能长期用的内战档案</h1><p class="lead">先把比赛记准确，再把玩家连起来。</p><div class="guidegrid"><div class="panel"><h3>01 · 截图成为草稿</h3><p>上传原始截图，AI 输出比赛 ID、时间、胜负、双方五人、英雄和 KDA。缺失字段留空，不猜测。用户核对后才入库。</p></div><div class="panel"><h3>02 · 一场比赛只算一次</h3><p>比赛 ID 唯一。多人上传同一场时补充证据，不新增战绩；修改有记录，撤销后重新计算排行榜。</p></div><div class="panel"><h3>03 · 玩家认领与改名</h3><p>未识别身份先建临时档案。提交群内昵称和 Dota 好友 ID 后立即认领。每个档案、每个 Dota ID 各绑定一次。</p></div><div class="panel"><h3>04 · 正式版的权限边界</h3><p>玩家可上传、认领和提交纠错。正式版管理员可合并或作废对局。服务端保存数据、截图与审计日志。AI 密钥只放服务端。</p></div></div><div class="note">新增对局和认领存储在当前浏览器。</div><div class="inlinebuttons"><button onclick="exportData()">导出本机数据 JSON</button><button onclick="resetDemo()">恢复已发布对局</button><a href="api-contract.md" target="_blank"><button>查看上传接口设计</button></a></div>`}
function exportData(){const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='inhouse-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function resetDemo(){if(!confirm('恢复已发布对局？将清除本机新增对局和认领记录。'))return;state=initialState();persist();render();toast('已恢复已发布对局')}
function render(){const [page='home',id]=location.hash.slice(1).split('/');document.getElementById('nav').innerHTML=[['home','◈','总览'],['matches','▤','所有对局'],['ranking','▥','排行榜'],['players','♧','群友档案'],['upload','＋','上传截图']].map(([p,icon,label])=>`<a href="#${p}" class="${page===p?'active':''}"><b>${icon}</b>${label}</a>`).join('');if(page!=='upload'){editingId=null;uploadVersion++;}({home,matches,ranking,players,upload,claims:players,guide,match:()=>detail(id),player:()=>profile(id)}[page]||home)();window.scrollTo(0,0)}
let incomingPaste = null;
window.addEventListener('paste', event => {
  if (event.target?.closest?.('input:not([type=file]), textarea, [contenteditable=true], dialog')) return;
  const items = Array.from(event.clipboardData?.items || []);
  const file = items.find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    || Array.from(event.clipboardData?.files || []).find(item => item.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  if (location.hash === '#upload') {
    if (uploadBusy) return;
    void loadFile(file);
  } else {
    incomingPaste = file;
    location.hash = 'upload';
  }
});
async function pasteClipboard() {
  if (uploadBusy) return;
  const version = uploadVersion;
  const hint = '请在本页按 Ctrl+V（Mac 用 ⌘V），或选择图片文件。';
  if (!navigator.clipboard?.read) return setUploadStatus(hint);
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type));
      if (!type) continue;
      const blob = await item.getType(type);
      if (version === uploadVersion) await loadFile(blob);
      return;
    }
    if (version === uploadVersion) setUploadStatus('剪贴板里没有图片，请先复制一张比赛截图。');
  } catch {
    if (version === uploadVersion) setUploadStatus(hint);
  }
}
window.addEventListener('hashchange', () => {
  render();
  if (incomingPaste && location.hash === '#upload') void loadFile(incomingPaste);
  incomingPaste = null;
});
render();
