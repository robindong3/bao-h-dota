"""Deliver screenshot-only recognition results to the site's private worker queue."""
import json
import logging
import os
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from codex_vision import recognize_with_codex

ROOT = Path(__file__).resolve().parent
URL = os.environ.get('DOTA_AGENT_URL', 'https://bao-h-dota.pages.dev')


def post(path, key, body=b'', previous=''):
    request = Request(URL + '/api/agent/' + path, data=body, headers={
        'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
        'User-Agent': 'bao-h-dota-recognizer/1.0', 'X-Previous':previous
    }, method='POST')
    return urlopen(request, timeout=30)


def run():
    import msvcrt
    lock = (ROOT / 'data' / '.agent-lock').open('a+b')
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return
    key = (ROOT / 'data' / '.agent-key').read_text().strip()
    next_sweep = 0
    previous = ''
    while True:
        try:
            if time.monotonic() >= next_sweep:
                with post('heartbeat', key):
                    pass
                previous = ''
                next_sweep = time.monotonic() + 150
            with post('next', key, previous=previous) as response:
                if response.status == 204:
                    previous = response.headers.get('X-Recent',previous)
                    time.sleep(6)
                    continue
                job = response.headers['X-Job']
                image = response.read()
            try:
                draft = recognize_with_codex(image, 'image/jpeg')
                if draft.get('is_match') and len(draft.get('players', [])) == 10:
                    result = {'draft': draft}
                else:
                    result = {'message': '未识别到完整对局，请粘贴双方十人的赛后截图。'}
            except Exception:
                logging.exception('Recognition failed')
                result = {'message': '截图已上传，本机识别失败。请重试或手动填写。'}
            body = json.dumps({'id': job, 'result': result}).encode()
            with post('complete', key, body):
                pass
            previous = ''
        except (HTTPError, OSError, ValueError) as error:
            logging.warning('Queue unavailable: %s', error)
            time.sleep(10)


if __name__ == '__main__':
    logging.basicConfig(filename=ROOT / 'data' / 'recognition-agent.log', level=logging.INFO)
    run()
