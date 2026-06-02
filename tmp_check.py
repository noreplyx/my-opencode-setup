#!/usr/bin/env python3
"""Check diagram section"""
with open('/home/oat/.config/opencode/skills/orchestration/SKILL.md', 'rb') as f:
    raw = f.read()

for term in [b'Phase 1', b'runs after parallel', b'Verify cross-file', b'Write code strictly', b'NTEGRATOR']:
    idx = raw.find(term)
    if idx >= 0:
        print(f'Found "{term.decode()}": at offset {idx}')
        print(f'  Context: {raw[idx:idx+80]}')
    else:
        print(f'"{term.decode()}": NOT FOUND')