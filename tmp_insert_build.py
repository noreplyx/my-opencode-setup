#!/usr/bin/env python3
"""Insert BUILD CHECK box after Integrator box"""

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

# Find the INTEGRATOR section end
# Look for "Integrator fixes Phase 2; build verifies)" then the ▼ after it
verify_line = raw.find(b'build verifies)')
if verify_line < 0:
    print("ERROR: Could not find 'build verifies)'")
    exit(1)

# Find the ▼ after this line
line_end = raw.find(b'\r\n', verify_line)
after_line = line_end + 2

# Now we should find ▼ then blank line then LINT GATE box
# Current content after the build verifies line:
print(f"After 'build verifies)': {raw[after_line:after_line+100]!r}")

# We need to insert the BUILD CHECK box between ▼ and LINT GATE
# The corrupted chars for the boxes
CORNER_TL = b'\xc3\xa2\xe2\x80\x9d\xc5\x92'  # ┌
HORIZ = b'\xc3\xa2\xe2\x80\x9d\xe2\x82\xac'   # ─
TEE_DOWN = b'\xc3\xa2\xe2\x80\x9d\xc2\xb4'     # ┬ (used in ┌──┬──┐ for boxes)
CORNER_TR = b'\xc3\xa2\xe2\x80\x9d\xc2\x90'    # ┐
VERT = b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x9a'     # │
TRIANGLE_DOWN = b'\xc3\xa2\xe2\x80\x93\xc2\xbc'  # ▼
CORNER_BL = b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x9d'  # └
TEE_UP = b'\xc3\xa2\xe2\x80\x9d\xc2\xac'          # ┴ (used in └──┴──┘ for boxes)
CORNER_BR = b'\xc3\xa2\xe2\x80\x9d\xcb\x9c'        # ┘
ARROW = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'        # →

# BUILD CHECK box (same style as INTEGRATOR box)
build_box = (
    b'    ' + CORNER_TL + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + TEE_DOWN + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + CORNER_TR + b'\r\n'
    b'    ' + TRIANGLE_DOWN + b' BUILD CHECK ' + TRIANGLE_DOWN + b' (MANDATORY)\r\n'
    b'    ' + VERT + b'  Implementor MUST run build ' + VERT + b'\r\n'
    b'    ' + VERT + b'  and return full build output' + VERT + b'\r\n'
    b'    ' + CORNER_BL + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + TEE_UP + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + CORNER_BR + b'\r\n'
    b'          ' + VERT + b' (build fails ' + ARROW + b' Implementor fixes, rebuilds)\r\n'
    b'          ' + TRIANGLE_DOWN + b'\r\n'
)

# Find what comes after "build verifies)" 
# The current content is: ...build verifies)\r\n          ▼\r\n\r\n    ┌──┬──┐\r\n    ▼ LINT GATE...
# We need to insert BUILD CHECK between the ▼ line and the blank line

# After build verifies), we have: "\r\n          ▼\r\n\r\n" followed by the LINT GATE box
# Let me find the first ▼ after build verifies line
after_verify = raw[after_line:]
# Find the ▼
idx_tri = after_verify.find(TRIANGLE_DOWN)
if idx_tri < 0:
    print("ERROR: Could not find ▼ after build verifies")
    exit(1)

# What follows the ▼ line?
after_tri = after_verify[idx_tri:]
print(f"After ▼: {after_tri[:60]!r}")

# Find the end of the ▼ line 
after_tri_line = after_tri.find(b'\r\n')
# Now after the ▼ line, there should be a blank line then LINT GATE box
# Find the LINT GATE box (next ┌──┬──┐)
next_box = after_tri.find(CORNER_TL, after_tri_line)
print(f"Next box at offset {next_box} from ▼ line")

# Everything between the ▼ line end and the next box should be replaced with BUILD CHECK
old_content = after_tri[after_tri_line:next_box]
print(f"Content to replace: {old_content!r}")

# The replacement should be: blank line + BUILD CHECK box
new_content = b'\r\n' + build_box

# Reconstruct
raw = raw[:after_line] + after_tri[:after_tri_line+2] + new_content + after_tri[next_box:]

with open(FILEPATH, 'wb') as f:
    f.write(raw)

print("✅ BUILD CHECK box inserted!")

# Verify
with open(FILEPATH, 'rb') as f:
    raw = f.read()
if b'BUILD CHECK' in raw:
    print("BUILD CHECK present in file")
else:
    print("WARNING: BUILD CHECK not found!")
count_mc = raw.count(b'MERGE COORDINATOR')
print(f"MERGE COORDINATOR occurrences: {count_mc}")
count_int = raw.count(b'NTEGRATOR')
print(f"INTEGRATOR occurrences: {count_int}")