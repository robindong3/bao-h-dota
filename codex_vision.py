"""Invoke the installed Codex CLI with a trusted screenshot extraction skill."""
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Semaphore

ROOT = Path(__file__).resolve().parent
SKILL = ROOT / '.agents' / 'skills' / 'dota-match-extraction'
MODEL = 'gpt-6.2-sol'
SLOT = Semaphore(1)
FORMATS = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}


def recognize_with_codex(raw, mime):
    executable = shutil.which('codex.exe') or shutil.which('codex')
    if not executable:
        raise RuntimeError('Codex CLI unavailable')
    prompt = (SKILL / 'SKILL.md').read_text(encoding='utf-8')
    schema = SKILL / 'references' / 'draft.schema.json'
    if not SLOT.acquire(blocking=False):
        raise BlockingIOError('Codex is processing another screenshot')
    try:
        with TemporaryDirectory(prefix='dota-vision-') as directory:
            image = Path(directory) / ('match' + FORMATS[mime])
            output = Path(directory) / 'draft.json'
            image.write_bytes(raw)
            env = os.environ.copy()
            env.pop('OPENAI_API_KEY', None)
            command = [executable, 'exec', '--ephemeral', '--ignore-user-config',
                       '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy="never"',
                       '--disable', 'shell_tool', '--disable', 'plugins', '--disable', 'js_repl',
                       '-c', 'web_search="disabled"',
                       '--model', MODEL, '--image', str(image), '--output-schema', str(schema),
                       '--output-last-message', str(output), '--color', 'never']
            result = subprocess.run(command, input=prompt, cwd=directory, env=env,
                                    text=True, encoding='utf-8', errors='replace',
                                    capture_output=True, timeout=150)
            if result.returncode or not output.is_file():
                raise RuntimeError('Codex invocation failed')
            return json.loads(output.read_text(encoding='utf-8'))
    finally:
        SLOT.release()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    args = parser.parse_args()
    mime = next((kind for kind, suffix in FORMATS.items() if args.image.suffix.lower() == suffix), None)
    if not mime or args.image.stat().st_size > 8 * 1024 * 1024:
        parser.error('Expected a PNG, JPG or WEBP image up to 8 MB')
    print(json.dumps(recognize_with_codex(args.image.read_bytes(), mime)))
