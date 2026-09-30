#!/usr/bin/env bash
# Vault validator for the monthly-bucket layout. Stdlib only (bash + python3).
# Usage: bash docs/Validators/check.sh  (run from repo root)
set -u
python3 - <<'PY'
import json, re, sys
from datetime import date as _cal_date
from pathlib import Path

DOCS = Path("docs")
MONTH_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]"
SCOPE = sorted(DOCS.glob(MONTH_GLOB)) + [DOCS / "Home.md", DOCS / "Templates", DOCS / "Validators"]
ENTRYPOINTS = {"docs/Home.md"} | {str(p) for p in DOCS.glob(f"{MONTH_GLOB}/*-hub.md")}
REQUIRED = ["title", "date", "type", "status", "tags", "related", "slug"]
ADR_EXTRA = ["adr", "supersedes", "superseded-by"]
ALLOW = ("flowchart", "sequenceDiagram", "classDiagram", "stateDiagram-v2", "erDiagram", "gantt")
LEGACY_PREFIXES = ("docs/2026-09-29/", "docs/daily/", "docs/templates/", "docs/_index.md")
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
ENC_TRAVERSAL_RE = re.compile(r"%(2e|2f|5c)", re.I)
errors = []

def is_calendar_date(s):
    try:
        _cal_date.fromisoformat(s)
        return True
    except ValueError:
        return False

def scope_files():
    out = []
    for s in SCOPE:
        if s.is_file():
            out.append(s)
        elif s.is_dir():
            out += [p for p in sorted(s.rglob("*")) if p.is_file() and p.suffix in (".md", ".canvas", ".svg")]
    return out

def parse_frontmatter(text, path):
    # Frontmatter limitation: single-line "key: value" pairs only. Continuation
    # lines and block scalars are not YAML-parsed; unexpected lines are
    # reported as bad frontmatter lines, so keep values on one line.
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if not m:
        return None
    fm, i = {}, 0
    for line in m.group(1).splitlines():
        if re.match(r"^\s*(---|\.\.\.)\s*$", line):
            continue
        kv = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not kv:
            errors.append(f"{path}: bad frontmatter line: {line!r}")
            continue
        fm[kv.group(1)] = kv.group(2).strip()
    return fm

notes = [p for p in scope_files() if p.suffix == ".md" and p.parent.name != "Validators"]
link_re = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
mdlink_re = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
mermaid_re = re.compile(r"```mermaid\n(.*?)```", re.S)
tldr_re = re.compile(r"^##\s+TL;DR\s*:?\s*$\n(.*?)(?=^##\s|\Z)", re.M | re.S | re.I)
inlinks = {}
svg_embeds, svg_files = set(), set()

def resolve(target, note):
    t = target.strip().strip("<>")
    if t.startswith(("http://", "https://", "#")):
        return "external"
    if ENC_TRAVERSAL_RE.search(t):
        return None
    t = t.split("#")[0].split("?")[0].strip()
    if not t or t.startswith(("/", "file://", "C:", "\\")) or ".." in Path(t).parts:
        return None
    cands = []
    if t.endswith(".svg") or t.endswith(".canvas") or t.endswith(".md"):
        cands += [note.parent / t, DOCS / t]
    else:
        cands += [note.parent / t, note.parent / (t + ".md"), DOCS / t, DOCS / (t + ".md")]
    for cand in cands:
        if cand.is_file():
            return str(cand)
    return None

def bucket_of(key):
    m = re.match(r"^docs/(\d{4}-\d{2})/", key)
    return m.group(1) if m else None

def is_template(key):
    return "/Templates/" in key

for p in notes:
    text = p.read_text(encoding="utf-8")
    key = str(p)
    # 1. frontmatter
    fm = parse_frontmatter(text, key)
    if fm is None:
        errors.append(f"{key}: missing frontmatter block")
        continue
    for k in REQUIRED:
        if k not in fm:
            errors.append(f"{key}: frontmatter missing key {k!r}")
    if fm.get("type") == "adr":
        for k in ADR_EXTRA:
            if k not in fm:
                errors.append(f"{key}: adr frontmatter missing key {k!r}")
    if is_template(key):
        continue  # scaffolds carry <slug>/{{date}} placeholders; links below lint live notes only
    # 5. absolute paths
    for pat in ("](/", "](C:", "](file://", "](/home", "/home/", "/Users/", "C:\\"):
        if pat in text:
            errors.append(f"{key}: absolute path literal {pat!r}")
    # 2. wikilinks
    for t in link_re.findall(text):
        r = resolve(t, p)
        if r is None:
            errors.append(f"{key}: dangling wikilink [[{t}]]")
        elif r != "external":
            inlinks[r] = inlinks.get(r, 0) + 1
            if t.strip().endswith(".svg"):
                svg_embeds.add(r)
            if bucket_of(r) and bucket_of(r) != bucket_of(key) and r != "docs/Home.md" and not r.startswith(LEGACY_PREFIXES):
                errors.append(f"{key}: cross-month link [[{t}]] resolves outside {bucket_of(key)}")
    # 3. mermaid
    for body in mermaid_re.findall(text):
        first = body.strip().splitlines()[0].strip() if body.strip() else ""
        token = first.split()[0].rstrip(";") if first.split() else ""
        if token not in ALLOW:
            errors.append(f"{key}: mermaid not in allowlist: {first!r}")
        if "%%{init" in body.replace(" ", ""):
            errors.append(f"{key}: mermaid %%{{init}} JS banned")
    # 4. svg embeds via md links
    for u in mdlink_re.findall(text):
        u = u.strip().strip("<>")
        if u.endswith(".svg"):
            r = resolve(u, p)
            if r is None:
                errors.append(f"{key}: svg embed missing: {u!r}")
            elif r != "external":
                inlinks[r] = inlinks.get(r, 0) + 1
                svg_embeds.add(r)
        elif bucket_of(key) and not u.startswith(("http://", "https://", "#")):
            r = resolve(u, p)
            if r and r != "external" and bucket_of(r) and bucket_of(r) != bucket_of(key) and r != "docs/Home.md" and not r.startswith(LEGACY_PREFIXES):
                errors.append(f"{key}: cross-month link ({u}) resolves outside {bucket_of(key)}")
    # 9. TL;DR budget (KD-05): at most 5 bullets AND at most 60 words
    m = tldr_re.search(text)
    if m:
        bullets = [ln for ln in m.group(1).splitlines() if re.match(r"^\s*-\s+\S", ln)]
        words = len(m.group(1).split())
        if len(bullets) > 5:
            errors.append(f"{key}: TL;DR exceeds 5 bullets ({len(bullets)})")
        if words > 60:
            errors.append(f"{key}: TL;DR exceeds 60 words ({words})")
    # 10. month rollover: folder name must equal date[0:7] inside month buckets
    date_val = fm.get("date", "").strip('"')
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_val) and not is_calendar_date(date_val):
        errors.append(f"{key}: date {fm['date']} is not a calendar date")
    if bucket_of(key) and re.match(r"^\d{4}-\d{2}-\d{2}$", fm.get("date", "").strip('"')):
        if fm["date"].strip('"')[:7] != bucket_of(key):
            errors.append(f"{key}: date {fm['date']} disagrees with month folder {bucket_of(key)}")

for p in scope_files():
    if p.suffix == ".svg":
        svg_files.add(str(p))
for s in svg_files - svg_embeds:
    errors.append(f"{s}: orphan svg, embedded by no note")
# 6. orphans: in-scope notes with no inlinks and not entry points/templates
for p in notes:
    key = str(p)
    if key in ENTRYPOINTS or is_template(key) or "/Validators/" in key:
        continue
    if inlinks.get(key, 0) == 0:
        errors.append(f"{key}: orphan note, no inlinks")
# 7. canvas
for p in scope_files():
    if p.suffix != ".canvas":
        continue
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"{p}: canvas JSON invalid: {e}")
        continue
    ids = [n.get("id") for n in data.get("nodes", [])]
    if len(ids) != len(set(ids)):
        errors.append(f"{p}: canvas duplicate node ids")
    for n in data.get("nodes", []):
        if n.get("type") == "file" and "file" in n:
            if not (DOCS / n["file"]).is_file():
                errors.append(f"{p}: canvas node missing: {n['file']!r}")
        if "x" in n or "y" in n:
            if not isinstance(n.get("x"), (int, float)) or not isinstance(n.get("y"), (int, float)):
                errors.append(f"{p}: canvas node {n.get('id')!r} has non-numeric x/y")
    edge_ids = [e.get("id") for e in data.get("edges", [])]
    if len(edge_ids) != len(set(edge_ids)):
        errors.append(f"{p}: canvas duplicate edge ids")
    for e in data.get("edges", []):
        if e.get("fromNode") not in ids:
            errors.append(f"{p}: canvas edge {e.get('id')!r} references unknown fromNode {e.get('fromNode')!r}")
        if e.get("toNode") not in ids:
            errors.append(f"{p}: canvas edge {e.get('id')!r} references unknown toNode {e.get('toNode')!r}")
# 8. triple status agreement + ADR NNN uniqueness (Stage 6 idempotency contract)
triples = {}
adr_numbers = {}
name_re = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)-(plan|decision|adr-(\d+))\.md$")
for p in notes:
    key = str(p)
    if is_template(key):
        continue
    text = p.read_text(encoding="utf-8")
    fm = parse_frontmatter(text, key)
    if fm is None:
        continue
    m = name_re.match(p.name)
    date = fm.get("date", "").strip('"')
    if not m or not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        continue
    slug_val = fm.get("slug", "").strip('"').strip("'")
    if slug_val and slug_val != m.group(2):
        errors.append(f"{key}: slug {slug_val!r} mismatches filename slug {m.group(2)!r}")
    kind = m.group(3)
    triples.setdefault((date, m.group(2)), {})[kind if not kind.startswith("adr-") else "adr"] = (key, fm.get("status", ""))
    if fm.get("type") == "adr" or kind.startswith("adr-"):
        seen = set()
        seen.add(fm.get("adr", "").strip('"').lstrip("0") or "")
        if m.group(4):
            seen.add(m.group(4).lstrip("0"))
        for n in seen:
            if n:
                adr_numbers.setdefault(n, set()).add(key)
for (date, slug), kinds in triples.items():
    if "adr" in kinds and kinds["adr"][1] == "accepted":
        for k in ("plan", "decision"):
            if k in kinds and kinds[k][1] != "approved":
                errors.append(f"{kinds[k][0]}: status {kinds[k][1]!r} disagrees with accepted ADR for {date}/{slug} (expected approved)")
    for k in ("plan", "decision"):
        if k in kinds and kinds[k][1] == "approved" and "adr" in kinds and kinds["adr"][1] not in ("accepted",):
            errors.append(f"{kinds['adr'][0]}: status {kinds['adr'][1]!r} disagrees with approved {k} for {date}/{slug} (expected accepted)")
for nnn, keys in adr_numbers.items():
    if len(keys) > 1:
        errors.append(f"duplicate ADR number {nnn}: {', '.join(sorted(keys))}")

if errors:
    print(f"FAIL: {len(errors)} problem(s)")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print(f"PASS: {len(notes)} notes, {len(svg_files)} svg, canvases OK")
PY
