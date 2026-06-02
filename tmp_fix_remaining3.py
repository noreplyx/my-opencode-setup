#!/usr/bin/env python3
"""Fix the 2 remaining active Merge Coordinator references"""
FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

corrupt_arrow = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'

# Fix 1: Parallel Feature pipeline table (offset 55785)
old1 = b'| **Parallel Feature** | Feature with independent sub-components | Implementor (parallel) ' + corrupt_arrow + b' Merge Coordinator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier | Yes |'
new1 = b'| **Parallel Feature** | Feature with independent sub-components | Implementor (parallel) ' + corrupt_arrow + b' Integrator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier | Yes |'

assert old1 in raw, 'old1 not found!'
raw = raw.replace(old1, new1)
print('Fixed: Parallel Feature table row')

# Fix 2: Full pipeline table (offset 59214)  
old2 = b'| **Full** | Finder ' + corrupt_arrow + b' Brainstorm ' + corrupt_arrow + b' PlanDescriber ' + corrupt_arrow + b' Implementor (parallel) ' + corrupt_arrow + b' Merge Coordinator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier ' + corrupt_arrow + b' Documentor | New feature in unfamiliar domain, complex changes, or parallel sub-tasks | ' + b'\xc3\xa2\xc5\x93\xe2\x80\xa6' + b' Yes |'
new2 = b'| **Full** | Finder ' + corrupt_arrow + b' Brainstorm ' + corrupt_arrow + b' PlanDescriber ' + corrupt_arrow + b' Implementor (parallel) ' + corrupt_arrow + b' Integrator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier ' + corrupt_arrow + b' Documentor | New feature in unfamiliar domain, complex changes, or parallel sub-tasks | ' + b'\xc3\xa2\xc5\x93\xe2\x80\xa6' + b' Yes |'

assert old2 in raw, 'old2 not found!'
raw = raw.replace(old2, new2)
print('Fixed: Full pipeline table row')

# Verify
remaining = []
idx = 0
while True:
    idx = raw.find(b'Merge Coordinator', idx)
    if idx < 0:
        break
    remaining.append(idx)
    idx += 1

print(f'\nRemaining Merge Coordinator references: {len(remaining)}')
for pos in remaining:
    line_start = raw.rfind(b'\n', 0, pos) + 1
    line_end = raw.find(b'\n', pos)
    print(f'  At {pos}: {raw[line_start:line_end]}')

# Should only be the 2 intentional ones
assert len(remaining) == 2, 'Expected exactly 2 intentional references'

with open(FILEPATH, 'wb') as f:
    f.write(raw)
print('\nDone!')