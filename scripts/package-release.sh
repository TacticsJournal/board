#!/usr/bin/env bash
set -euo pipefail

root_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

for tool in node npm zip tar sha256sum; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'error: required tool not found: %s\n' "$tool" >&2
    exit 1
  fi
done

version="$(node -e "const fs = require('node:fs'); process.stdout.write(JSON.parse(fs.readFileSync('package.json', 'utf8')).version)")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  printf 'error: package.json has an invalid release version: %s\n' "$version" >&2
  exit 1
fi

printf 'Building self-hosted bundle for version %s...\n' "$version"
rm -rf dist
npm run build:self-hosted

notice_files=(
  LICENSE TRADEMARKS.md THIRD_PARTY_NOTICES.md README.md SECURITY.md SUPPORT.md
  CONTRIBUTING.md CODE_OF_CONDUCT.md CHANGELOG.md CITATION.cff
)
for path in dist/index.html "${notice_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    printf 'error: required release file is missing: %s\n' "$path" >&2
    exit 1
  fi
done
if [[ ! -d docs ]]; then
  printf 'error: required release directory is missing: docs\n' >&2
  exit 1
fi

release_dir="$root_dir/release"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/tacticsjournal-board-release.XXXXXX")"
trap 'rm -rf "$stage_dir"' EXIT

rm -rf "$release_dir"
mkdir -p "$release_dir"
cp -a dist/. "$stage_dir/"
cp "${notice_files[@]}" "$stage_dir/"
cp -a docs "$stage_dir/"

archive_base="tacticsjournal-board-$version"
zip_path="$release_dir/$archive_base.zip"
tar_path="$release_dir/$archive_base.tar.gz"

(
  cd "$stage_dir"
  zip -q -X -r "$zip_path" .
)
tar -czf "$tar_path" -C "$stage_dir" .

(
  cd "$release_dir"
  sha256sum "$(basename "$zip_path")" "$(basename "$tar_path")" > SHA256SUMS
)

printf 'Created:\n  %s\n  %s\n  %s\n' "$zip_path" "$tar_path" "$release_dir/SHA256SUMS"
