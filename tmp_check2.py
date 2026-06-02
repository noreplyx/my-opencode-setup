#!/usr/bin/env python3
"""Check if file was written correctly"""
with open('/home/oat/.config/opencode/skills/orchestration/SKILL.md', 'rb') as f:
    raw = f.read()

corrupt_arrow = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'
old1 = b'Implementor (parallel) ' + corrupt_arrow + b' Merge Coordinator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier'

print(f'old1 in raw: {old1 in raw}')
print(f'Merge Coordinator count: {raw.count(b"Merge Coordinator")}')

# Check Parallel Feature line
idx = raw.find(b'Parallel Feature')
if idx >= 0:
    line_end = raw.find(b'\r\n', idx)
    line = raw[idx:line_end]
    print(f'Parallel Feature line: {line!r}')