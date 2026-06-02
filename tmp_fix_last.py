#!/usr/bin/env python3
"""Fix the last remaining Merge Coordinator references"""

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

# Find the remaining MERGE COORDINATOR
idx = raw.find(b'MERGE COORDINATOR')
if idx >= 0:
    context = raw[idx-30:idx+100]
    print(f"Found remaining at offset {idx}:")
    print(context)
    print()
    # Check if it's in the @contract line
    if b'@contract' in raw[idx-50:idx]:
        print("It's in the @contract section")
        # Find the corrupted arrows  
        # The corrupted → is \xc3\xa2\xe2\x80\xa0\xe2\x80\x99
        arrow = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'
        line_start = raw.rfind(b'\n', 0, idx) + 1
        line_end = raw.find(b'\n', idx)
        line = raw[line_start:line_end]
        print(f"Full line: {line!r}")
        
        # Replace the arrow + "Merge Coordinator verifies" + arrow
        old = arrow + b' Merge Coordinator verifies ' + arrow + b' Block on mismatch'
        new = arrow + b' Integrator Phase 1 verifies ' + arrow + b' Block on mismatch'
        raw = raw.replace(old, new)
        print("Fixed @contract line")
    else:
        # It's something else - show more context
        print("Unknown location - searching more context...")
        line_start = raw.rfind(b'\n', 0, idx) + 1
        line_end = raw.find(b'\n', idx)
        line = raw[line_start:line_end]
        print(f"Full line: {line!r}")

# Final check
count = raw.count(b'MERGE COORDINATOR')
print(f"\nRemaining MERGE COORDINATOR occurrences: {count}")

# Also check for lowercase forms
for term in [b'merge-coordinator', b'merge_coordinator', b'merge coordinator']:
    c = raw.count(term)
    if c > 0:
        print(f"Remaining '{term.decode()}': {c}")

with open(FILEPATH, 'wb') as f:
    f.write(raw)

print("\nDone!")