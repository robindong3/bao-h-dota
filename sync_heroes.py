"""Refresh the Chinese/English hero list and download official portrait assets."""
import base64
import hashlib
from io import BytesIO
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parent / 'dist'
CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/'


def download(url):
    with urlopen(url, timeout=20) as response:
        return response.read()


def save_portrait(hero):
    target = ROOT / 'heroes' / (hero['slug'] + '.png')
    if target.exists() and target.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):
        return
    for image_url in (f'{CDN}{target.name}', f'{CDN}wide/{target.name}'):
        try:
            content = download(image_url)
            if content.startswith(b'\x89PNG\r\n\x1a\n'):
                target.write_bytes(content)
                return
        except OSError:
            continue
    raise RuntimeError(f'Missing portrait for {hero["slug"]}')


def portrait_bundle(heroes):
    portraits = {}
    for hero in heroes:
        slug = hero['slug']
        with Image.open(ROOT / 'heroes' / (slug + '.png')) as source:
            source.thumbnail((112, 64), Image.Resampling.LANCZOS)
            output = BytesIO()
            source.save(output, format='WEBP', quality=78)
            portraits[slug] = base64.b64encode(output.getvalue()).decode('ascii')
    return 'const DOTA_PORTRAITS = ' + json.dumps(portraits, indent=2) + ';\n'


def main():
    data = json.loads(download('https://www.dota2.com/datafeed/herolist?language=schinese'))
    heroes = []
    for item in data['result']['data']['heroes']:
        slug = item['name'].removeprefix('npc_dota_hero_')
        if not re.fullmatch(r'[a-z0-9_]+', slug):
            raise ValueError(f'Unexpected hero key: {slug}')
        heroes.append(dict(id=item['id'], slug=slug, name=item['name_loc'], english=item['name_english_loc']))
    (ROOT / 'heroes').mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=10) as executor:
        list(executor.map(save_portrait, heroes))
    samples = {hashlib.sha256(path.read_bytes()).hexdigest(): path.stem.removeprefix('match-')
               for path in ROOT.glob('match-*.png')}
    (ROOT / 'hero-data.js').write_text(
        'const DOTA_HEROES = ' + json.dumps(heroes, ensure_ascii=False, indent=2) + ';\n'
        'const SAMPLE_SCREENSHOTS = ' + json.dumps(samples, indent=2) + ';\n'
        + portrait_bundle(heroes), encoding='utf-8')
    print(f'Downloaded or verified {len(heroes)} portraits and {len(samples)} sample hashes.')


if __name__ == '__main__':
    main()
