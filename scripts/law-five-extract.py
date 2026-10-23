"""Extract only the pinned five records. Offline; never generates release approvals."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import zipfile


def extract(archive, output):
    spec = json.loads(Path(__file__).with_name('law-five-selection.json').read_text())
    with zipfile.ZipFile(archive) as pack:
        member = pack.infolist()[spec['member_index']]
        if member.filename != spec['member_name']:
            raise ValueError('ZIP member identity differs; use the reviewed shared pack')
        data = pack.read(member)
    if hashlib.sha256(data).hexdigest() != spec['member_sha256']:
        raise ValueError('ZIP member hash mismatch')
    lines = gzip.decompress(data).splitlines()
    chosen = []
    for expected in spec['records']:
        line = lines[expected['line'] - 1]
        if hashlib.sha256(line).hexdigest() != expected['record_sha256']:
            raise ValueError('record hash mismatch')
        record = json.loads(line)
        if record['source_key'] != expected['source_key'] or hashlib.sha256(record['text'].encode()).hexdigest() != expected['text_sha256']:
            raise ValueError('source/text mismatch')
        chosen.append(line)
    with open(output, 'xb') as target:
        target.write(b'\n'.join(chosen) + b'\n')
    print(json.dumps({'extracted': len(chosen), 'output': str(output), 'network_requests': 0}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    extract(args.archive, args.output)
