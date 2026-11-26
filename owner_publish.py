"""Store owner-reviewed matches locally and deploy a shared Pages snapshot."""
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from threading import Lock

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
OWNER = ROOT / 'data' / 'owner'
UPLOADS = OWNER / 'uploads'
CONFIRMED = OWNER / 'confirmed'
PREFIX = 'const PUBLISHED_MATCHES = '
PUBLISH_LOCK = Lock()
JOB = re.compile(r'[0-9a-f]{64}')
MATCH = re.compile(r'[0-9]{6,12}')
IMAGE = re.compile(r'data:image/(jpeg|png|webp);base64,(.+)')


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        file.write(data)
    os.replace(file.name, path)


def write_json(path, data):
    atomic(path, json.dumps(data, ensure_ascii=False).encode())


def keep_upload(job, image, result=None):
    if not JOB.fullmatch(job) or not image.startswith(b'\xff\xd8\xff'):
        raise ValueError('Invalid screenshot')
    receipt = UPLOADS / (job + '.json')
    if receipt.exists() and json.loads(receipt.read_text('utf-8')).get('confirmed'):
        return
    if result is None:
        atomic(UPLOADS / (job + '.jpg'), image)
        if not receipt.exists():
            write_json(receipt, {'processing':True})
    else:
        write_json(receipt, result)


def waiting_uploads():
    drafts = []
    for path in sorted(UPLOADS.glob('*.json'), key=lambda f: f.stat().st_mtime, reverse=True):
        job = path.stem
        if not JOB.fullmatch(job) or not (UPLOADS / (job + '.jpg')).exists():
            continue
        result = json.loads(path.read_text('utf-8'))
        if result.get('confirmed'):
            continue
        draft = result.get('draft') or {'players': [{} for _ in range(10)]}
        drafts.append({**draft, 'job': job, 'processing':result.get('processing',False),
                       'source': '/api/owner/screenshot/' + job,
                       'message': result.get('message', '')})
    return drafts


def published_matches(directory=DIST):
    payload = (directory / 'published-matches.js').read_text('utf-8-sig')
    return json.JSONDecoder().raw_decode(payload.removeprefix(PREFIX))[0]


def published_ids():
    return {match['id'] for match in published_matches()}


def confirm_match(match, job=None):
    match_id = match['id']
    if not isinstance(match_id, str) or not MATCH.fullmatch(match_id):
        raise ValueError('请输入有效的比赛 ID。')
    if match_id in published_ids() or (CONFIRMED / (match_id + '.json')).exists():
        raise FileExistsError('这场比赛已确认或发布，未重复登记。')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', match['date']) or not re.fullmatch(r'(?:\d{1,3}|\d{1,2}:[0-5]\d):[0-5]\d', match['duration']):
        raise ValueError('请检查日期和时长。')
    if match['winner'] not in ('radiant', 'dire') or not all(type(match[k]) is int and 0 <= match[k] <= 999 for k in ('radiant', 'dire')):
        raise ValueError('请检查获胜方和比分。')
    players = match['players']
    if len(players) != 10 or len({p['pid'] for p in players}) != 10:
        raise ValueError('请检查十人阵容，每个档案每场只出现一次。')
    clean_players = []
    for p in players:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', p['pid']) or not all(0 < len(p[k].strip()) <= 60 for k in ('nickname', 'hero')):
            raise ValueError('请补全玩家昵称和英雄。')
        if not all(type(p[k]) is int and 0 <= p[k] <= 999999 for k in ('kills', 'deaths', 'assists', 'gold')):
            raise ValueError('请检查击杀、死亡、助攻和净资产。')
        clean_players.append({k: p[k] for k in ('pid', 'nickname', 'hero', 'kills', 'deaths', 'assists', 'gold')})
    if job and JOB.fullmatch(job):
        image = (UPLOADS / (job + '.jpg')).read_bytes()
        ext = 'jpg'
    elif item := IMAGE.fullmatch(match.get('source', '')):
        mime, code = item.groups()
        image = base64.b64decode(code, validate=True)
        ext = 'jpg' if mime == 'jpeg' else mime
    elif previous := re.fullmatch(r'/api/import-screenshot/([0-9]{6,12})', match.get('source', '')):
        image = (ROOT / 'data' / 'inbox' / (previous[1] + '.png')).read_bytes()
        ext = 'png'
    else:
        raise ValueError('请附上比赛截图。')
    if not image or len(image) > 8 * 1024 * 1024:
        raise ValueError('截图容量无效。')
    if not (ext == 'jpg' and image.startswith(b'\xff\xd8\xff')
            or ext == 'png' and image.startswith(b'\x89PNG\r\n\x1a\n')
            or ext == 'webp' and image[:4] == b'RIFF' and image[8:12] == b'WEBP'):
        raise ValueError('图片文件格式无效。')
    record = {k: match[k] for k in ('id', 'date', 'duration', 'radiant', 'dire', 'winner')}
    record.update(mode=str(match.get('mode') or '未识别')[:60], players=clean_players,
                  source=f'match-{match_id}.{ext}', sourceHash=hashlib.sha256(image).hexdigest())
    atomic(CONFIRMED / record['source'], image)
    write_json(CONFIRMED / (match_id + '.json'), record)
    if job:
        write_json(UPLOADS / (job + '.json'), {'confirmed':match_id})
    return record


def publish():
    known = published_ids()
    matches = [json.loads(path.read_text('utf-8')) for path in CONFIRMED.glob('*.json') if path.stem not in known]
    if not matches:
        return 0
    cli = Path(os.environ.get('DOTA_WRANGLER_DIR', ROOT))
    wrangler = cli / 'node_modules' / 'wrangler' / 'bin' / 'wrangler.js'
    node = shutil.which('node.exe') or shutil.which('node') or os.environ.get('DOTA_NODE')
    if not node or not wrangler.exists():
        raise RuntimeError('找不到 Node 或 Wrangler，无法发布。')
    env = os.environ.copy()
    config_home = os.environ.get('DOTA_WRANGLER_CONFIG_HOME')
    if config_home:
        env['XDG_CONFIG_HOME'] = config_home
    project = os.environ.get('DOTA_PAGES_PROJECT', 'bao-h-dota')
    with tempfile.TemporaryDirectory(dir=OWNER) as directory:
        stage = Path(directory) / 'dist'
        shutil.copytree(DIST, stage)
        for match in matches:
            shutil.copyfile(CONFIRMED / match['source'], stage / match['source'])
        combined = published_matches() + matches
        release = hashlib.sha256(','.join(sorted(item['id'] for item in combined)).encode()).hexdigest()[:12]
        data = PREFIX + json.dumps(combined, ensure_ascii=False, indent=2) + ';\n'
        data += f'const PUBLISHED_RELEASE = "{release}";\n'
        (stage / 'published-matches.js').write_text(data, 'utf-8')
        index = re.sub(r'published-matches\.js(?:\?v=[a-zA-Z0-9-]+)?', 'published-matches.js?v=' + release,
                       (stage / 'index.html').read_text('utf-8'))
        (stage / 'index.html').write_text(index, 'utf-8')
        result = subprocess.run([node, str(wrangler), 'pages', 'deploy', str(stage),
                                 '--project-name', project, '--branch', 'main', '--commit-dirty=true'],
                                cwd=ROOT, env=env, capture_output=True, timeout=150)
        (OWNER / 'publish.log').write_bytes(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError('Cloudflare 发布失败，已确认对局仍保存在本机。')
        for name in [match['source'] for match in matches] + ['published-matches.js', 'index.html']:
            atomic(DIST / name, (stage / name).read_bytes())
    return len(matches)
