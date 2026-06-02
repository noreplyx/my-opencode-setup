#!/usr/bin/env python3
"""Debug diagram replacement issue"""

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

# Find all occurrences of MERGE COORDINATOR
idx = 0
positions = []
while True:
    idx = raw.find(b'MERGE COORDINATOR', idx)
    if idx < 0:
        break
    positions.append(idx)
    idx += 1

print(f"Found {len(positions)} occurrences of 'MERGE COORDINATOR'")
for i, pos in enumerate(positions):
    print(f"\n--- Occurrence {i+1} at offset {pos} ---")
    # Show surrounding bytes
    start = max(0, pos - 60)
    end = min(len(raw), pos + 120)
    snippet = raw[start:end]
    print(repr(snippet))
    
    # Show as readable context
    print()
    # Find line boundaries
    line_start = raw.rfind(b'\n', 0, pos) + 1
    line_end = raw.find(b'\n', pos)
    line = raw[line_start:line_end]
    print(f"Line: {line!r}")

# Find the diagram section - search for the IMPLEMENTOR section
impl_idx = raw.find(b'IMPLEMENTOR \xc3\xa2\xe2\x80\x93\xe2\x80\xa0')
if impl_idx < 0:
    impl_idx = raw.find(b'IMPLEMENTOR')
print(f"\n\nIMPLEMENTOR found at offset: {impl_idx}")
# Show 80 bytes after
print(repr(raw[impl_idx:impl_idx+120]))