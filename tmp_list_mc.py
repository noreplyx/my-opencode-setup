#!/usr/bin/env python3
"""List all Merge Coordinator occurrences"""
with open('/home/oat/.config/opencode/skills/orchestration/SKILL.md', 'rb') as f:
    raw = f.read()

idx = 0
count = 0
while True:
    idx = raw.find(b'Merge Coordinator', idx)
    if idx < 0:
        break
    count += 1
    line_start = raw.rfind(b'\n', 0, idx) + 1
    line_end = raw.find(b'\n', idx)
    print(f'{count}. At offset {idx}: {raw[line_start:line_end]}')
    idx += 1