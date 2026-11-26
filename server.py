"""Loopback-only development preview and optional image-recognition endpoint."""
import base64
import json
import os
import re
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from subprocess import TimeoutExpired

from codex_vision import recognize_with_codex
from owner_publish import UPLOADS, PUBLISH_LOCK, confirm_match, publish, waiting_uploads

ROOT = Path(__file__).resolve().parent
CODEX_ENABLED = os.getenv('DOTA_LOCAL_CODEX') == '1'
INBOX = ROOT / 'data' / 'inbox'
OWNER_ORIGINS = ('http://127.0.0.1:19374', 'http://localhost:19374')
LOCAL_HOSTS = ('127.0.0.1:19374', 'localhost:19374')

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def send_json(self, code, body):
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith('/api/') and self.headers.get('Host') not in LOCAL_HOSTS:
            return self.send_json(403, {'error': 'LOCAL_ONLY'})
        if self.path == '/api/health':
            return self.send_json(200, {'aiConfigured': CODEX_ENABLED})
        if self.path == '/api/import-drafts':
            drafts = waiting_uploads()
            for path in sorted(INBOX.glob('*.json'), reverse=True):
                if not re.fullmatch(r'[0-9]{6,12}', path.stem):
                    continue
                try:
                    draft = json.loads(path.read_text(encoding='utf-8-sig'))
                    if draft.get('id') == path.stem and len(draft.get('players', [])) == 10:
                        draft['source'] = f'/api/import-screenshot/{path.stem}'
                        drafts.append(draft)
                except (AttributeError, OSError, TypeError, ValueError):
                    continue
            return self.send_json(200, {'drafts': drafts})
        screenshot = re.fullmatch(r'/api/import-screenshot/([0-9]{6,12})', self.path)
        queued = re.fullmatch(r'/api/owner/screenshot/([0-9a-f]{64})', self.path)
        if screenshot or queued:
            try:
                file = UPLOADS / (queued[1] + '.jpg') if queued else INBOX / (screenshot[1] + '.png')
                data = file.read_bytes()
            except OSError:
                return self.send_json(404, {'error': 'NOT_FOUND'})
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg' if queued else 'image/png')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if self.path.startswith('/api/'):
            return self.send_json(404, {'error': 'NOT_FOUND'})
        return super().do_GET()

    def do_POST(self):
        if self.headers.get('Host') not in LOCAL_HOSTS:
            return self.send_json(403, {'error': 'LOCAL_ONLY'})
        if self.path.startswith('/api/owner/'):
            return self.handle_owner()
        if self.path != '/api/recognize':
            return self.send_json(404, {'error': 'NOT_FOUND'})
        if self.headers.get('Origin') not in (None, 'http://127.0.0.1:19374', 'http://localhost:19374'):
            return self.send_json(403, {'error': 'ORIGIN_REJECTED'})
        if not CODEX_ENABLED:
            return self.send_json(503, {'error': 'AI_NOT_CONFIGURED', 'message': '本机 Codex 识别尚未启用。'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 12 * 1024 * 1024:
                return self.send_json(413, {'error': 'IMAGE_TOO_LARGE'})
            body = json.loads(self.rfile.read(length))
            image = body['image']
            prefix, encoded = image.split(',', 1)
            if prefix not in ('data:image/jpeg;base64', 'data:image/png;base64', 'data:image/webp;base64'):
                raise ValueError()
            raw = base64.b64decode(encoded, validate=True)
            if len(raw) > 8 * 1024 * 1024:
                return self.send_json(413, {'error': 'IMAGE_TOO_LARGE'})
            mime = prefix.removeprefix('data:').removesuffix(';base64')
            is_jpeg = mime == 'image/jpeg' and raw.startswith(b'\xff\xd8\xff')
            is_png = mime == 'image/png' and raw.startswith(b'\x89PNG\r\n\x1a\n')
            is_webp = mime == 'image/webp' and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP'
            if not (is_jpeg or is_png or is_webp):
                raise ValueError()
        except (KeyError, ValueError, TypeError):
            return self.send_json(400, {'error': 'INVALID_IMAGE'})
        try:
            draft = recognize_with_codex(raw, mime)
            if isinstance(draft, dict) and draft.get('is_match') is False:
                return self.send_json(422, {'error': 'NOT_A_MATCH', 'message': '请选择一张 Dota 2 赛后结算截图。'})
            if not isinstance(draft, dict) or not isinstance(draft.get('players'), list) or len(draft['players']) != 10 or any(not isinstance(p, dict) for p in draft['players']):
                return self.send_json(422, {'error': 'INCOMPLETE_EXTRACTION', 'message': '没有识别出完整十人阵容，请换完整截图。'})
            allowed = ('id','date','duration','mode','radiant','dire','winner')
            clean = {k: draft.get(k) for k in allowed}
            clean['players'] = [{k: p.get(k) for k in ('nickname','hero','kills','deaths','assists','gold')} for p in draft['players']]
            return self.send_json(200, {'draft': clean, 'status': 'needs_review'})
        except BlockingIOError:
            return self.send_json(503, {'error': 'AI_BUSY', 'message': '正在识别另一张截图，请稍后重试。'})
        except TimeoutExpired:
            return self.send_json(504, {'error': 'AI_TIMEOUT', 'message': '识别超时，可以重试或手动填写。'})
        except (RuntimeError, OSError, ValueError):
            return self.send_json(502, {'error': 'AI_EXTRACTION_FAILED', 'message': '本机 Codex 未能返回识别结果。'})

    def handle_owner(self):
        if self.headers.get('Origin') not in OWNER_ORIGINS:
            return self.send_json(403, {'message':'请在本机管理页操作。'})
        if self.path not in ('/api/owner/confirm', '/api/owner/publish'):
            return self.send_json(404, {'error':'NOT_FOUND'})
        if not PUBLISH_LOCK.acquire(blocking=False):
            return self.send_json(409, {'message':'本机正在保存或发布，请稍后再试。'})
        try:
            if self.path == '/api/owner/publish':
                return self.send_json(200, {'published':publish()})
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 12 * 1024 * 1024:
                return self.send_json(413, {'message':'截图太大。'})
            body = json.loads(self.rfile.read(length))
            return self.send_json(201, {'match':confirm_match(body['match'], body.get('job'))})
        except FileExistsError as error:
            return self.send_json(409, {'message':str(error)})
        except (ValueError, TypeError, KeyError) as error:
            return self.send_json(400, {'message':str(error)})
        except TimeoutExpired:
            return self.send_json(504, {'message':'发布查询超时，已确认对局仍保存在本机。'})
        except (RuntimeError, OSError) as error:
            return self.send_json(502, {'message':str(error)})
        finally:
            PUBLISH_LOCK.release()

if __name__ == '__main__':
    print('Local preview: http://127.0.0.1:19374', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 19374), Handler).serve_forever()
