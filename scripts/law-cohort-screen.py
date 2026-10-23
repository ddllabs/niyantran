"""Screen a bounded next Law cohort from the shared legal pack ZIP, offline and read-only.

This is the reproducible replacement for the inventory artifacts that exist only on the
original operator's computer. It never contacts a database, never calls a provider, and never
writes an eligible decision by itself. Two commands:

  screen    read one pinned member of the ZIP, take candidate records in file order, check each
            against the adapter contract and the pack's own policy files (sensitivity, dedupe,
            not-in-pack, __full replacements, repeated occurrences across the collection subtree),
            and write screen.json (evidence) plus candidates.jsonl (the exact original lines of
            the candidates that passed every local check). Candidates are "ready for review",
            not eligible.
  finalize  after the owner has approved the screened cohort, turn screen.json into a
            content-bound decisions.jsonl: one row per approved source, bound to its text hash,
            the exact candidates.jsonl hash and the evidence hash. Held sources are refused, and
            so is any screen whose policy hashes were not verified against --expect-policy-hashes
            or whose conflict scan was skipped (--no-scan-subtree is exploratory only).

Every central-directory occurrence of a repeated name is hashed and checked (policy files and
the collection subtree); only byte-identical repeats are skipped.

The importer (scripts/corpus-text-import.mjs) then runs its own dry run and, only with a
separately authorized submission, registers the sources.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

POLICY_MEMBERS = (
    'flags/sensitive_cases_v1.csv.gz',
    'dedupe/duplicate_documents_v1.csv.gz',
    'not_in_pack/still_not_in_pack_v1.csv.gz',
)
MAX_CHARS = 600_000  # SUPPLIED_TEXT.maxChars in supabase/functions/_shared/suppliedText.ts
SCREEN_SCHEMA = 2  # 2: every repeated entry checked; finalize requires verified policy hashes and a complete scan
SHA = re.compile(r'^[a-f0-9]{64}$')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def member_sha256(pack, info):
    h = hashlib.sha256()
    with pack.open(info) as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def pack_root(pack):
    roots = {n.split('/', 1)[0] for n in pack.namelist() if '/' in n}
    if len(roots) != 1:
        raise ValueError(f'archive must have one internal root folder, found {sorted(roots)}')
    return roots.pop()


def find_members(pack, name):
    """All central-directory entries for one path (repeated names are legal in this pack)."""
    return [i for i in pack.infolist() if i.filename == name]


def gz_lines(pack, info):
    """Yield (line_number, raw_line_without_newline) from a compressed JSONL member."""
    with pack.open(info) as fh, gzip.GzipFile(fileobj=fh) as gz:
        for n, raw in enumerate(gz, 1):
            yield n, raw.rstrip(b'\r\n')


def gz_csv_rows(pack, info):
    with pack.open(info) as fh, gzip.GzipFile(fileobj=fh) as gz:
        yield from csv.DictReader(io.TextIOWrapper(gz, encoding='utf-8', newline=''))


def check_record(record, raw, source_prefix):
    """Replicates the offline parts of prepareSuppliedText; returns a list of hold reasons."""
    reasons = []
    key = record.get('source_key')
    if not isinstance(key, str) or not key.startswith('law:'):
        return ['not a Law source_key']
    if source_prefix and not key.startswith(source_prefix):
        reasons.append(f'source_key outside {source_prefix}')
    text = record.get('text')
    if not isinstance(text, str) or not text.strip():
        return reasons + ['missing text']
    h = sha256(text.encode('utf-8'))
    if record.get('text_sha256') != h:
        reasons.append('text_sha256 does not match text')
    if record.get('content_sha256') not in (None, h):
        reasons.append('content_sha256 does not match text')
    if len(text) > MAX_CHARS:
        reasons.append(f'text exceeds {MAX_CHARS} characters (held, never truncated)')
    if '\0' in text:
        reasons.append('text contains NUL')
    if record.get('desk_tier') != 'law':
        reasons.append('desk_tier is not law')
    if not isinstance(record.get('title'), str) or not record['title'].strip() or len(record['title']) > 300:
        reasons.append('invalid title')
    if not isinstance(record.get('citation'), dict) or not record['citation']:
        reasons.append('citation is empty')
    if record.get('text_quality') not in (None, 'ok'):
        reasons.append(f"text_quality {record.get('text_quality')!r} is not ok")
    if record.get('page_split') not in (None, 'exact', 'none'):
        reasons.append(f"incomplete page declaration page_split={record.get('page_split')!r}")
    pages = record.get('pages')
    if pages is not None:
        if not isinstance(pages, list):
            reasons.append('pages is not a list')
        else:
            end, seen = 0, set()
            for p in pages:
                a, b, num = p.get('char_from'), p.get('char_to'), p.get('page_number')
                if not (isinstance(a, int) and isinstance(b, int) and 0 <= a <= b <= len(text)):
                    reasons.append('page span out of bounds')
                    break
                if a < end or not isinstance(num, int) or num < 1 or num in seen:
                    reasons.append('overlapping or duplicate page')
                    break
                if 'text' in p and p['text'] != text[a:b]:
                    reasons.append('page text mismatch')
                    break
                seen.add(num)
                end = b
            for count_key in ('n_pages', 'page_count'):
                if record.get(count_key) is not None and record[count_key] != len(pages):
                    reasons.append(f'{count_key} mismatch')
    if record.get('n_chars') is not None and record['n_chars'] != len(text):
        reasons.append('n_chars mismatch')
    for url_key in ('file_url', 'file_url_alt', 'source_archive_url'):
        u = record.get(url_key)
        if u is not None and not re.match(r'^https?://[^@\s]+$', str(u)):
            reasons.append(f'invalid {url_key}')
    if not record.get('file_url'):
        reasons.append('no public source URL')
    if not (record.get('licence') or record.get('licence_class')):
        reasons.append('no licence declaration')
    if not record.get('attribution'):
        reasons.append('no attribution')
    return reasons


def screen(args):
    archive = Path(args.archive)
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    screen_path, cand_path = out / 'screen.json', out / 'candidates.jsonl'
    for p in (screen_path, cand_path):
        if p.exists():
            raise FileExistsError(f'{p} exists; use a fresh output directory')
    excluded = set()
    for path in args.exclude_decisions or []:
        for line in Path(path).read_text('utf-8').splitlines():
            if line.strip():
                excluded.add(json.loads(line)['source_key'])
    with zipfile.ZipFile(archive) as pack:
        root = pack_root(pack)
        full_name = args.member if args.member.startswith(root + '/') else f'{root}/{args.member}'
        entries = find_members(pack, full_name)
        if not entries:
            raise FileNotFoundError(f'member not in archive: {full_name}')
        hashes = {member_sha256(pack, e) for e in entries}
        if len(hashes) != 1:
            raise ValueError('repeated member name with differing bytes; refuse to choose silently')
        member = entries[0]
        member_info = {
            'name': full_name, 'index': pack.infolist().index(member), 'occurrences': len(entries),
            'sha256': hashes.pop(), 'compressed_bytes': member.compress_size, 'bytes': member.file_size,
        }
        if args.expect_member_sha256 and args.expect_member_sha256 != member_info['sha256']:
            raise ValueError('member hash differs from the expected value')
        # 1. candidate records in file order
        candidates, scanned = [], 0
        for line_no, raw in gz_lines(pack, member):
            if line_no < args.start_line:
                continue
            if scanned >= args.max_scan:
                break
            scanned += 1
            try:
                record = json.loads(raw.decode('utf-8'))
            except (UnicodeDecodeError, ValueError) as e:
                candidates.append({'line': line_no, 'disposition': 'held', 'reasons': [f'unreadable record: {e}']})
                continue
            key = record.get('source_key')
            c = {
                'line': line_no, 'source_key': key, 'title': record.get('title'), 'record_sha256': sha256(raw),
                'text_sha256': record.get('text_sha256'), 'n_pages': record.get('n_pages'),
                'n_chars': len(record.get('text') or ''), 'file_url': record.get('file_url'),
                'document_key_suggested': record.get('document_key_suggested'),
                'licence': record.get('licence') or record.get('licence_class'), 'attribution': record.get('attribution'),
                'page_split': record.get('page_split'), 'text_quality': record.get('text_quality'),
                'raw_desk_feature': record.get('desk_feature'), 'reasons': check_record(record, raw, args.source_prefix),
            }
            if key in excluded:
                c['reasons'].append('already decided in an earlier manifest (pilot); not a new source')
            c['_raw'] = raw
            c['disposition'] = 'held' if c['reasons'] else 'ready_for_review'
            candidates.append(c)
        keys = {c['source_key'] for c in candidates if c.get('source_key')}
        key_bytes = [k.encode('utf-8') for k in keys]
        # 2. policy files inside the ZIP (internal members are authoritative; external copies differ)
        policy = {}
        expected = {}
        if args.expect_policy_hashes:
            expected = json.loads(Path(args.expect_policy_hashes).read_text('utf-8')).get('member_hashes', {})
        for rel in POLICY_MEMBERS:
            infos = find_members(pack, f'{root}/{rel}')
            if not infos:
                policy[rel] = {'present': False, 'verified': False}
                for c in candidates:
                    c['reasons'].append(f'policy file missing from archive: {rel}')
                continue
            # Every central-directory occurrence is hashed and read: a repeated name may hide different rows.
            occ_hashes = [member_sha256(pack, i) for i in infos]
            want = expected.get(rel)
            verified = bool(want) and all(h == want for h in occ_hashes)
            policy[rel] = {
                'present': True, 'sha256': occ_hashes[0], 'occurrences': len(infos), 'occurrence_sha256': occ_hashes,
                'conflicting_occurrences': len(set(occ_hashes)) > 1, 'expected_sha256': want,
                'matches_pilot_evidence': (all(h == want for h in occ_hashes)) if expected else None, 'verified': verified,
            }
            if not verified:
                why = ('no expected hash supplied' if not want else
                       'repeated entries differ' if len(set(occ_hashes)) > 1 else 'hash differs from expected')
                for c in candidates:
                    c['reasons'].append(f'policy file not verified ({rel}: {why})')
            hits = defaultdict(list)
            seen_policy = set()
            for info, h in zip(infos, occ_hashes):
                if h in seen_policy:
                    continue  # byte-identical repeat: same rows
                seen_policy.add(h)
                for row in gz_csv_rows(pack, info):
                    k = row.get('source_key') or row.get('doc_id') or row.get('id')
                    if k in keys or any(v in keys for v in row.values() if isinstance(v, str)):
                        hits[k if k in keys else next(v for v in row.values() if v in keys)].append(row)
            policy[rel]['candidate_rows'] = sum(len(v) for v in hits.values())
            for c in candidates:
                rows = hits.get(c.get('source_key'))
                if not rows:
                    continue
                if rel.startswith('flags/'):
                    c['sensitivity'] = [{'tier': r.get('tier'), 'categories': r.get('categories')} for r in rows]
                    c['reasons'].append('sensitivity flag: serving-policy review required')
                elif rel.startswith('dedupe/'):
                    c['dedupe'] = [{k2: r.get(k2) for k2 in ('group', 'match', 'keep', 'file', 'why')} for r in rows]
                    if any(str(r.get('keep')) == '0' for r in rows):
                        c['reasons'].append('declared duplicate alias (keep=0); not a second searchable document')
                    member_base = os.path.basename(full_name)
                    if any(str(r.get('keep')) == '1' and r.get('file') and os.path.basename(r['file']) != member_base for r in rows):
                        c['reasons'].append('dedupe keeper names a different file/revision than this member')
                else:
                    c['reasons'].append('listed in still_not_in_pack')
        # 3. replacement (__full) and repeated-occurrence scan across the collection subtree
        subtree = full_name.rsplit('/', 1)[0] + '/'
        scan = {'subtree': subtree, 'complete': not args.no_scan_subtree, 'members_scanned': 0, 'occurrences': 0,
                'skipped_identical_repeats': 0, 'conflicting_repeated_members': []}
        name_hashes = defaultdict(set)
        occurrences = defaultdict(list)
        if not args.no_scan_subtree:
            for index, info in enumerate(pack.infolist()):
                if not info.filename.startswith(subtree) or not info.filename.endswith('.jsonl.gz'):
                    continue
                # Repeated names are scanned per occurrence; only byte-identical repeats are skipped.
                h = member_sha256(pack, info)
                if h in name_hashes[info.filename]:
                    scan['skipped_identical_repeats'] += 1
                    continue
                if name_hashes[info.filename]:
                    scan['conflicting_repeated_members'].append(info.filename)
                name_hashes[info.filename].add(h)
                scan['members_scanned'] += 1
                for line_no, raw in gz_lines(pack, info):
                    if not any(kb in raw for kb in key_bytes):
                        continue
                    try:
                        r = json.loads(raw.decode('utf-8'))
                    except (UnicodeDecodeError, ValueError):
                        continue
                    if r.get('source_key') in keys:
                        scan['occurrences'] += 1
                        occurrences[r['source_key']].append({
                            'member': info.filename, 'entry_index': index, 'line': line_no, 'text_sha256': r.get('text_sha256'),
                            'full': '__full' in os.path.basename(info.filename),
                        })
            for c in candidates:
                occ = occurrences.get(c.get('source_key'), [])
                c['occurrences'] = occ
                others = [o for o in occ if not (o['member'] == full_name and o['line'] == c['line'])]
                if any(o['full'] for o in others):
                    c['reasons'].append('superseded by a __full replacement record in another member')
                if any(o['text_sha256'] != c['text_sha256'] and not o['full'] for o in others):
                    c['reasons'].append('competing text revision in another member')
                if not occ:
                    c['reasons'].append('subtree scan did not find this record (unexpected)')
        for c in candidates:
            c['reasons'] = sorted(set(c['reasons']))
            c['disposition'] = 'held' if c['reasons'] else 'ready_for_review'
        ready = [c for c in candidates if c['disposition'] == 'ready_for_review'][: args.count]
        for c in candidates:
            if c['disposition'] == 'ready_for_review' and c not in ready:
                c['disposition'] = 'surplus_not_selected'
        body = b'\n'.join(c['_raw'] for c in ready) + b'\n' if ready else b''
        with open(cand_path, 'xb') as fh:
            fh.write(body)
        for c in candidates:
            c.pop('_raw', None)
        held = defaultdict(int)
        for c in candidates:
            if c['disposition'] == 'held':
                for r in c['reasons']:
                    held[r] += 1
        production_checks = {
            'policy_hashes_verified': all(p.get('verified') for p in policy.values()) and len(policy) == len(POLICY_MEMBERS),
            'subtree_scan_complete': not args.no_scan_subtree,
        }
        result = {
            'status': 'screened-not-approved', 'screen_schema': SCREEN_SCHEMA, 'production_eligible': False, 'database_writes': 0,
            'production_checks': production_checks, 'finalizable': all(production_checks.values()),
            'network_requests': 0, 'archive': {'name': archive.name, 'bytes': archive.stat().st_size, 'root': root},
            'member': member_info, 'feature': args.feature, 'source_prefix': args.source_prefix,
            'start_line': args.start_line, 'lines_scanned': scanned, 'excluded_keys': sorted(excluded),
            'policy_members': policy, 'subtree_scan': scan,
            'counts': {'ready_for_review': len(ready), 'held': sum(1 for c in candidates if c['disposition'] == 'held'),
                       'surplus_not_selected': sum(1 for c in candidates if c['disposition'] == 'surplus_not_selected')},
            'held_reasons': dict(held), 'candidates_jsonl_sha256': sha256(body), 'candidates': candidates,
            'not_checked_here': [
                'presence in the live database (the importer reconciles atomically at registration)',
                'exact chunk count and the 800-chunk limit (run the importer dry run; it uses the real chunker)',
                'semantic OCR accuracy and legal clearance (the review booleans remain the reviewer\'s attestation)',
            ],
        }
    screen_path.write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n', 'utf-8')
    os.chmod(screen_path, 0o600)
    os.chmod(cand_path, 0o600)
    print(json.dumps({k: v for k, v in result.items() if k not in ('candidates', 'excluded_keys')}, indent=1))


def finalize(args):
    screen_bytes = Path(args.screen).read_bytes()
    evidence = json.loads(screen_bytes)
    cand = Path(args.screen).with_name('candidates.jsonl')
    body = cand.read_bytes()
    if sha256(body) != evidence['candidates_jsonl_sha256']:
        raise ValueError('candidates.jsonl changed since screening')
    # A decision manifest attests identity/completeness/sensitivity/dedupe/rights; refuse any screen that did not
    # run every check those attestations depend on. Exploratory screens may skip work but cannot be finalized.
    if evidence.get('status') != 'screened-not-approved' or evidence.get('screen_schema') != SCREEN_SCHEMA:
        raise ValueError(f'screen evidence is not schema {SCREEN_SCHEMA}; re-screen with this version')
    checks = evidence.get('production_checks') or {}
    incomplete = [k for k in ('policy_hashes_verified', 'subtree_scan_complete') if checks.get(k) is not True]
    if incomplete:
        raise ValueError(f'screen evidence incomplete, refused: {incomplete}')
    chosen = [c for c in evidence['candidates'] if c['disposition'] == 'ready_for_review']
    if any(not c.get('occurrences') for c in chosen):
        raise ValueError('a ready candidate has no recorded conflict-scan occurrences; refused')
    if args.keys:
        wanted = set(args.keys)
        missing = wanted - {c['source_key'] for c in chosen}
        if missing:
            raise ValueError(f'not ready for review, refused: {sorted(missing)}')
        chosen = [c for c in chosen if c['source_key'] in wanted]
    if not chosen:
        raise ValueError('no ready candidates to finalize')
    out = Path(args.output)
    rows = []
    for i, c in enumerate(chosen, 1):
        if not SHA.match(c['text_sha256'] or ''):
            raise ValueError('candidate without a text hash')
        rows.append(json.dumps({
            'source_key': c['source_key'], 'text_sha256': c['text_sha256'],
            'file_sha256': evidence['candidates_jsonl_sha256'], 'desk_feature': evidence['feature'],
            'review': {
                'status': 'eligible', 'source_key': c['source_key'], 'text_sha256': c['text_sha256'],
                'rules_sha256': sha256(screen_bytes), 'package_id': args.package_id,
                'mapping_version': args.mapping_version, 'decision_id': f'{args.decision_id}-{i}',
                'approved_by': args.approved_by,
                'checks': {'identity': True, 'completeness': True, 'sensitivity': True, 'dedupe': True, 'rights': True},
            },
        }, ensure_ascii=False))
    manifest = ('\n'.join(rows) + '\n').encode('utf-8')
    with open(out, 'xb') as fh:
        fh.write(manifest)
    os.chmod(out, 0o600)
    print(json.dumps({'decisions': str(out), 'sources': len(rows), 'manifest_sha256': sha256(manifest),
                      'rules_sha256': sha256(screen_bytes), 'file_sha256': evidence['candidates_jsonl_sha256']}))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    s = sub.add_parser('screen', help='screen candidates from one ZIP member (offline, read-only)')
    s.add_argument('--archive', required=True)
    s.add_argument('--member', required=True, help='member path inside the pack, with or without the root folder')
    s.add_argument('--output-dir', required=True, help='fresh private staging directory outside the repository')
    s.add_argument('--feature', required=True, help='existing Law feature in deskCatalog.json for the decision rows')
    s.add_argument('--source-prefix', default='law:trib:IBBI_NCLT:')
    s.add_argument('--start-line', type=int, default=1)
    s.add_argument('--count', type=int, default=5)
    s.add_argument('--max-scan', type=int, default=20,
                   help='screen at most this many records from --start-line; the first --count that pass are selected')
    s.add_argument('--exclude-decisions', action='append', help='decision manifests whose keys are already decided')
    s.add_argument('--expect-member-sha256')
    s.add_argument('--expect-policy-hashes',
                   help='JSON with member_hashes for the three policy files; required for a finalizable screen')
    s.add_argument('--no-scan-subtree', action='store_true',
                   help='exploratory only: skips the conflict scan, and the screen cannot be finalized')
    s.set_defaults(func=screen)
    f = sub.add_parser('finalize', help='write a content-bound decisions.jsonl from an approved screen.json')
    f.add_argument('--screen', required=True)
    f.add_argument('--output', required=True)
    f.add_argument('--decision-id', required=True, help='traceable owner decision, e.g. owner-authorized-20261024-law-cohort-2')
    f.add_argument('--approved-by', required=True)
    f.add_argument('--package-id', default='nter.legal_pack/1.2 handover-2026-10-18')
    f.add_argument('--mapping-version', default='law-cohort-v1')
    f.add_argument('--keys', nargs='*', help='subset of approved source keys (default: every ready candidate)')
    f.set_defaults(func=finalize)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, FileExistsError, FileNotFoundError) as e:
        print(f'refused: {e}', file=sys.stderr)
        sys.exit(1)
