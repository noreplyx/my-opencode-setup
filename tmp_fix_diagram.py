#!/usr/bin/env python3
"""Fix the remaining MERGE COORDINATOR diagram - remove old box and replace with single INTEGRATOR box"""

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

# Find the text "parallel dispatch)" which is just before the old diagram
parallel_dispatch_idx = raw.find(b'parallel dispatch)')
line_after_dispatch = raw.find(b'\n', parallel_dispatch_idx) + 1

# Go to the line after "parallel dispatch)" - this should be the branch "│" going to the diagram
# Then find the old MERGE COORDINATOR box and the old INTEGRATOR box
# We already replaced the bottom INTEGRATOR box, but the top MERGE COORDINATOR box is still there

# Find: "│ (inconsistencies found → Fixer, then re-run Merge Coordinator)"  
# This should be in the old diagram text that wasn't replaced yet

# Look for the pattern after the diagram start
# Old diagram box top: corrupted ┌──────┴──────┐
corner_tl = b'\xc3\xa2\xe2\x80\x9d\xc5\x92'  # ┌ (corrupted)
triangle_down = b'\xc3\xa2\xe2\x80\x93\xc2\xbc'  # ▼ (corrupted)
vert = b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x9a'  # │ (corrupted)

# Find the MERGE COORDINATOR line and remove from there through the old INTEGRATOR box
mc_line = raw.find(b'\xc3\xa2\xe2\x80\x93\xc2\xbc MERGE COORDINATOR')
if mc_line < 0:
    print("ERROR: Could not find MERGE COORDINATOR line")
    exit(1)

# Go to the start of this line
mc_line_start = raw.rfind(b'\n', 0, mc_line) + 1

# Find where this section ends - after "wiring issues → Integrator fixes; build verifies"
# Let's search for the text that was part of the old Integrator diagram
# The old text was: "│ (wiring issues → Integrator fixes; build verifies)"
wiring_issues = raw.find(b'wiring issues', mc_line)
if wiring_issues < 0:
    print("ERROR: Could not find 'wiring issues' text")
    exit(1)

# Find the end of this section - it should be "▼" + start of BUILD CHECK
# Go past the wiring issues line
after_wiring = raw.find(b'\n', wiring_issues) + 1
# The next line should have ▼
# The next line after that should have BUILD CHECK diagram box
# Let's go to ▼ after wiring line and then to the BUILD CHECK diagram
# Actually, the new diagram already has a ▼ line for Integrator output

# Let me check what's already been replaced
# After previous replacements, we should see the new Integrator merged box
# Let's find "INTEGRATOR  ▼ (MERGED" which represents the new diagram
merged_integrator = raw.find(b'INTEGRATOR')
print(f"INTEGRATOR found at offset: {merged_integrator}")

# Show what's around both
print(f"\nAround MERGE COORDINATOR (offset {mc_line_start}):")
print(repr(raw[mc_line_start:mc_line_start+80]))

print(f"\nAround INTEGRATOR (offset {merged_integrator}):")
print(repr(raw[merged_integrator-10:merged_integrator+120]))

# So the issue is: the file now has BOTH the old MERGE COORDINATOR box AND the new INTEGRATOR merged box
# We need to remove everything from mc_line_start up to the start of the new INTEGRATOR box

# Find the end of the old Merge Coordinator section
# Look for "wiring issues → Integrator fixes; build verifies" line
idx_wiring = raw.find(b'build verifies)', mc_line)
print(f"\n'build verifies)' found at offset: {idx_wiring}")

# Go to end of that line (after )\r\n)
end_of_old = raw.find(b'\n', idx_wiring) + 1

print(f"\nOld diagram range: {mc_line_start} to {end_of_old}")
old_diagram = raw[mc_line_start:end_of_old]
print(f"Old diagram content:")
print(repr(old_diagram))

# Now replace this old diagram with nothing (it's redundant with the new Integrator diagram)
raw = raw[:mc_line_start] + raw[end_of_old:]

# Clean up: if there are any blank lines or orphaned branch chars after removal
# Check the result
count = raw.count(b'MERGE COORDINATOR')
print(f"\nRemaining MERGE COORDINATOR occurrences: {count}")

# Check for duplicate INTEGRATOR sections
int_count = raw.count(b'INTEGRATOR')
print(f"INTEGRATOR occurrences: {int_count}")

with open(FILEPATH, 'wb') as f:
    f.write(raw)

print("\nDone!")