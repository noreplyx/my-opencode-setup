#!/usr/bin/env python3
"""Fix remaining 3 Merge Coordinator references"""

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

changes = 0

# Fix 1: Pipeline table - "Implementor (parallel) → Merge Coordinator → Build"
# The arrows in this file are \xe2\x86\x92 (→) or encoded differently
# Let me search with the pattern around "Parallel Feature"
# Line 977: | **Parallel Feature** | ... | Implementor (parallel) â†’ Merge Coordinator â†’ Build ...
# The arrows are \xe2\x86\x92 in UTF-8

old1 = b'Implementor (parallel) \xe2\x86\x92 Merge Coordinator \xe2\x86\x92 Build'
# Check if this exists
count1 = raw.count(old1)
print(f"Pattern 1 occurrences: {count1}")
if count1 > 0:
    raw = raw.replace(old1, b'Implementor (parallel) \xe2\x86\x92 Integrator \xe2\x86\x92 Build')
    changes += 1
    print("Fixed: Pipeline table 1")
else:
    # Try the corrupted arrow version used elsewhere
    arrow_corrupt = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'
    # Search for "Implementor (parallel)" followed by Merge Coordinator
    idx = raw.find(b'Implementor (parallel)')
    while idx >= 0:
        # Check if Merge Coordinator follows within 50 bytes
        end_check = raw.find(b'\r\n', idx)
        line = raw[idx:end_check]
        if b'Merge Coordinator' in line:
            print(f"Found at {idx}: {line!r}")
        idx = raw.find(b'Implementor (parallel)', idx + 1)

# Also check for the arrow being a simple dash
old1b = b'Implementor (parallel) \x2d Merge Coordinator \x2d Build'
count1b = raw.count(old1b)
if count1b > 0:
    raw = raw.replace(old1b, b'Implementor (parallel) - Integrator - Build')
    changes += 1
    print("Fixed: Pipeline table 1b (dash)")

# Fix 2: Full pipeline - "Finder → Brainstorm → PlanDescriber → Implementor (parallel) → Merge Coordinator → Build"
old2 = b'PlanDescriber \xe2\x86\x92 Implementor (parallel) \xe2\x86\x92 Merge Coordinator \xe2\x86\x92 Build'
count2 = raw.count(old2)
print(f"Pattern 2 occurrences: {count2}")
if count2 > 0:
    raw = raw.replace(old2, b'PlanDescriber \xe2\x86\x92 Implementor (parallel) \xe2\x86\x92 Integrator \xe2\x86\x92 Build')
    changes += 1
    print("Fixed: Pipeline table 2")
else:
    # Try single bytes
    idx = raw.find(b'PlanDescriber')
    while idx >= 0:
        end_check = raw.find(b'\r\n', idx)
        line = raw[idx:end_check]
        if b'Merge Coordinator' in line:
            print(f"Found PlanDescriber line: {line!r}")
        idx = raw.find(b'PlanDescriber', idx + 1)

# Fix 3: @contract line - with corrupted arrow
corrupt_arrow = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'
old3 = corrupt_arrow + b' Merge Coordinator verifies ' + corrupt_arrow + b' Block on mismatch'
count3 = raw.count(old3)
print(f"Pattern 3 occurrences: {count3}")
if count3 > 0:
    raw = raw.replace(old3, corrupt_arrow + b' Integrator Phase 1 verifies ' + corrupt_arrow + b' Block on mismatch')
    changes += 1
    print("Fixed: @contract arrow line")
else:
    # Search for it differently
    idx = raw.find(b'@contract annotations')
    if idx >= 0:
        line_end = raw.find(b'\r\n', idx)
        line = raw[idx:line_end]
        print(f"@contract line: {line!r}")

# Final check
for term in [b'MERGE COORDINATOR', b'Merge Coordinator', b'merge-coordinator', b'merge_coordinator']:
    count = raw.count(term)
    if count > 0:
        print(f"\nRemaining '{term.decode()}': {count} (checking if intentional)")
        # List all occurrences with line context
        idx = 0
        while True:
            idx = raw.find(term, idx)
            if idx < 0:
                break
            line_start = max(0, idx - 40)
            line_end = min(len(raw), idx + 80)
            print(f"  At {idx}: ...{raw[line_start:line_end]}...")
            idx += 1

with open(FILEPATH, 'wb') as f:
    f.write(raw)

print(f"\n✅ Done: {changes} changes")