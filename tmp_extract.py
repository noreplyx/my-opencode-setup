#!/usr/bin/env python3
"""Extract exact diagram bytes from SKILL.md"""
import re

with open('/home/oat/.config/opencode/skills/orchestration/SKILL.md', 'rb') as f:
    raw = f.read()

# Find MERGE COORDINATOR and get exact bytes of the diagram
idx = raw.find(b'MERGE COORDINATOR')
if idx < 0:
    print("ERROR: MERGE COORDINATOR not found")
    exit(1)

# Go back to find the start of the diagram box (first box-drawing char)
start = raw.rfind(b'\n', 0, idx - 80) + 1

# Go forward to find the end (look for BUILD CHECK)
end = raw.find(b'BUILD CHECK', idx)
end = raw.rfind(b'\n', 0, end - 5) + 1

diagram_bytes = raw[start:end]
print(f"Diagram from byte {start} to {end} (length: {end-start})")
print(f"Hex dump:")
for i in range(0, len(diagram_bytes), 16):
    chunk = diagram_bytes[i:i+16]
    hex_part = ' '.join(f'{b:02x}' for b in chunk)
    ascii_part = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
    print(f"  {i:04x}: {hex_part:<48s} {ascii_part}")

print()
print(f"Full bytes as repr: {diagram_bytes!r}")