#!/usr/bin/env python3
"""Fix the broken diagram section - re-insert the INTEGRATOR merged box"""

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

# Find the IMPLEMENTOR line
impl_line = raw.find(b'IMPLEMENTOR')
# Find the end of that line
impl_line_end = raw.find(b'\r\n', impl_line) + 2

# Show what follows the IMPLEMENTOR line
print("After IMPLEMENTOR line:")
print(repr(raw[impl_line_end:impl_line_end+200]))

# Find the branch char after IMPLEMENTOR
# Should find "│" (corrupted) after the IMPLEMENTOR line
# Let's see what we have after IMPLEMENTOR line
after_impl = raw[impl_line_end:]
# Find BUILD CHECK
build_check = after_impl.find(b'BUILD CHECK')
print(f"\nBUILD CHECK at offset {build_check} in remaining content")
print(f"Content between IMPLEMENTOR line end and BUILD CHECK:")
print(repr(after_impl[:build_check+20]))

# The content between IMPLEMENTOR and BUILD CHECK should be:
# Branch line, INTEGRATOR box, then "▼" before BUILD CHECK
# Currently it shows some corrupted box chars

# Let me find where the "▼" before BUILD CHECK is
triangle_before_build = after_impl.find(b'\xc3\xa2\xe2\x80\x93\xc2\xbc', 0, build_check)
print(f"\n▼ found before BUILD CHECK at offset: {triangle_before_build}")

# The corrupted box-drawing chars we need
CORNER_TL = b'\xc3\xa2\xe2\x80\x9d\xc5\x92'  # ┌ 
HORIZ = b'\xc3\xa2\xe2\x80\x9d\xe2\x82\xac'   # ─
TEE_DOWN = b'\xc3\xa2\xe2\x80\x9d\xc2\xb4'     # ┬
CORNER_TR = b'\xc3\xa2\xe2\x80\x9d\xc2\x90'    # ┐
VERT = b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x9a'     # │
TRIANGLE_DOWN = b'\xc3\xa2\xe2\x80\x93\xc2\xbc'  # ▼
CORNER_BL = b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x9d'  # └
TEE_UP = b'\xc3\xa2\xe2\x80\x9d\xc2\xac'          # ┴
CORNER_BR = b'\xc3\xa2\xe2\x80\x9d\xcb\x9c'        # ┘
ARROW = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'        # →
EM_DASH = b'\xc3\xa2\xe2\x82\xac\xe2\x80\x9d'      # —

# The Integrator merged box
new_box = (
    CORNER_TL + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + TEE_DOWN + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + CORNER_TR + b'\r\n'
    b'   ' + TRIANGLE_DOWN + b' INTEGRATOR  ' + TRIANGLE_DOWN + b' (MERGED ' + EM_DASH + b' Phase 1: 4-pass merge verification + Phase 2: wiring)\r\n'
    b'   ' + VERT + b'  Phase 1: Verify cross-file   ' + VERT + b'\r\n'
    b'   ' + VERT + b'  consistency (imports, type   ' + VERT + b'\r\n'
    b'   ' + VERT + b'  signatures, interfaces, re-  ' + VERT + b'\r\n'
    b'   ' + VERT + b'  exports). Score 0.0-1.0.    ' + VERT + b'\r\n'
    b'   ' + VERT + b'  Phase 2: Wire barrels, DI,   ' + VERT + b'\r\n'
    b'   ' + VERT + b'  routes, fix import paths.   ' + VERT + b'\r\n'
    b'   ' + CORNER_BL + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + TEE_UP + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + CORNER_BR + b'\r\n'
    b'          ' + VERT + b' (verification issues ' + ARROW + b' Fixer, re-run Integrator Phase 1)\r\n'
    b'          ' + VERT + b' (wiring issues ' + ARROW + b' Integrator fixes Phase 2; build verifies)\r\n'
    b'          ' + TRIANGLE_DOWN + b'\r\n'
)

# We need to insert the box between the IMPLEMENTOR line and the ▼ before BUILD CHECK
# The branch "│" after IMPLEMENTOR line should remain
# The current content after IMPLEMENTOR has:
# "   │\r\n" (branch) then "   ▼\r\n" (pointing down to BUILD CHECK)
# but these are corrupted bytes. Let me see exactly

# Actually the content shows: after IMPLEMENTOR line, there's a corrupted box start, 
# then "           ▼\r\n" before BUILD CHECK. The old box remnants were partially removed.

# Let me find: "   ┌──────┴──────┐\r\n           ▼\r\n    ┌──────┴──────┐\r\n    ▼ BUILD CHECK"
# In corrupted form:
old_content_start = b'   ' + CORNER_TL + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + TEE_DOWN + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + HORIZ + CORNER_TR + b'\r\n'
# This was the OLD box diagram remnant after partial removal

# Actually, looking at line 78-79 of the output: it shows box-drawing characters followed by "           ▼"
# The issue is: the data between IMPLEMENTOR line and BUILD CHECK has orphan box chars

# Let me take a simpler approach: find everything between IMPLEMENTOR line end and 
# the ▼ that points to BUILD CHECK, and replace it all with the new box

# Find the "▼" that's right before BUILD CHECK
# This is the ▼ at line 79: "           ▼"
before_build = after_impl.find(b'\r\n          ' + TRIANGLE_DOWN + b'\r\n')
if before_build < 0:
    # Try different spacing
    before_build = after_impl.find(TRIANGLE_DOWN + b'\r\n')
    
print(f"\n▼ before BUILD CHECK at: {before_build}")

if before_build >= 0:
    # Everything from impl_line_end to the ▼ (inclusive) is what needs replacement
    # Keep the branch line, replace everything else
    new_content = (
        b'          ' + VERT + b'\r\n'  # Branch line
        + new_box
    )
    
    # Find the end of the content to replace (the ▼ line before BUILD CHECK)
    # Go from impl_line_end, find the first ▼ that's followed by BUILD CHECK box
    # Actually the content to replace is: branch line + box + ▼
    # Keep just the branch line, replace everything else
    
    # Existing structure: 
    # IMPLEMENTOR line\n
    # "          │\n"  (branch - KEEP THIS)
    # "   ┌──────┴──────┐\n" (orphan box - REPLACE) 
    # "           ▼\n" (▼ before BUILD CHECK - this should stay as the arrow down from Integrator box)
    
    # Wait, actually the new box already ends with ▼, and then BUILD CHECK follows
    # So we replace everything between IMPLEMENTOR line and BUILD CHECK box with the new box
    
    # Let me find BUILD CHECK box start
    build_check_start = after_impl.find(b'\r\n    ' + CORNER_TL)
    if build_check_start < 0:
        build_check_start = after_impl.find(b'BUILD CHECK')
    
    print(f"BUILD CHECK box at offset {build_check_start}")
    
    if build_check_start > 0:
        # The content between impl_line_end and build_check_start needs replacement
        old_middle = after_impl[:build_check_start]
        print(f"Replacing {len(old_middle)} bytes between IMPLEMENTOR and BUILD CHECK")
        print(f"Old content: {old_middle!r}")
        
        # New middle: branch + Integrator box
        new_middle = (
            b'          ' + VERT + b'\r\n'  # Branch
            + new_box
        )
        
        # Reconstruct
        raw = raw[:impl_line_end] + new_middle + after_impl[build_check_start:]
        
        print(f"\nNew middle: {new_middle!r}")
        
        with open(FILEPATH, 'wb') as f:
            f.write(raw)
        
        print("✅ Diagram fixed!")
    else:
        print("❌ Could not find BUILD CHECK box start")
else:
    print("❌ Could not find ▼ before BUILD CHECK")
    # Debug: show raw bytes around impl_line_end
    print(f"Bytes after IMPLEMENTOR line:")
    print(repr(raw[impl_line_end:impl_line_end+300]))