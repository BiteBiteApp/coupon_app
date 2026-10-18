#!/usr/bin/env python3
"""Freeze or verify an exact, caller-supplied source list; never follows main later."""
import argparse
import hashlib
import json
from pathlib import Path

from guard import Rejected, digest, need


def source_path(root, relative):
    need(isinstance(relative, str) and relative, 'missing source path')
    path = Path(relative)
    need(not path.is_absolute() and '..' not in path.parts, 'source outside repository')
    need(not any(part in ('.git', 'node_modules', 'pgdata') for part in path.parts), 'runtime data is not source')
    need(not any(part.startswith('.env') or part in ('auth.json', 'credentials.json', 'synthetic-cursor-key') for part in path.parts), 'credential material prohibited')
    candidate = root / path
    need(candidate.is_file() and not candidate.is_symlink(), 'missing file or symlink: ' + relative)
    need(candidate.resolve().is_relative_to(root.resolve()), 'source resolves outside repository')
    return candidate


def freeze(root, paths):
    need(bool(paths) and len(set(paths)) == len(paths), 'empty or duplicate source list')
    hashes = {name: hashlib.sha256(source_path(root, name).read_bytes()).hexdigest()
              for name in sorted(paths)}
    result = {'schemaVersion': 1, 'sha256': hashes}
    result['candidateDigest'] = digest(result)
    return result


def verify(root, manifest):
    recorded = json.loads(manifest.read_text())
    need(recorded.get('schemaVersion') == 1 and isinstance(recorded.get('sha256'), dict), 'invalid candidate manifest')
    actual = freeze(root, list(recorded['sha256']))
    need(actual == recorded, 'candidate changed after freeze; requalify before replacing manifest')
    return actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--paths-file', type=Path)
    args = parser.parse_args()
    if args.paths_file:
        need(not args.manifest.exists(), 'freeze refuses to overwrite an existing qualified manifest')
        paths = args.paths_file.read_text().splitlines()
        result = freeze(args.root, paths)
        with args.manifest.open('x') as output:
            output.write(json.dumps(result, indent=2) + '\n')
    else:
        result = verify(args.root, args.manifest)
    print(json.dumps({'candidateDigest': result['candidateDigest'], 'files': len(result['sha256'])}))


if __name__ == '__main__':
    try:
        main()
    except (Rejected, KeyError, TypeError, ValueError) as error:
        raise SystemExit(str(error))
