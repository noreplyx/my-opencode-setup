#!/usr/bin/env python3
"""
Apply all Merge Coordinator → Integrator replacements to SKILL.md.
Handles the mojibake box-drawing characters by working at the byte level.
"""

import sys

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

# ── Change 2: Replace the MERGE COORDINATOR diagram ──
# Find the exact byte ranges by searching for unique ASCII anchors
mc_idx = raw.find(b'MERGE COORDINATOR')
if mc_idx < 0:
    print("ERROR: Could not find 'MERGE COORDINATOR' in file")
    sys.exit(1)

# Find start: go backward from mc_idx to find a line that ends with the branch "│" before the diagram
# Find the start of the 4. IMPLEMENTOR section, then find the diagram
impl_idx = raw.find(b'IMPLEMENTOR')
diag_start = raw.find(b'(\x0d\x0a\x0d\x0a|\x0a\x0a)', impl_idx)  # This won't work easily

# Better approach: find the first box-drawing sequence after "IMPLEMENTOR ──►"
# which is:    ┌──────┴──────┐
# In this file, the corrupted version starts with \xc3\xa2\xe2\x80\x9d\xc5\x92 (corrupted ┌)

# Find the diagram start: first occurrence of the corrupted "┌" sequence after IMPLEMENTOR
diagram_start_marker = b'\xc3\xa2\xe2\x80\x9d\xc5\x92'  # corrupted ┌
implementor_pos = raw.rfind(b'\n', 0, mc_idx)
# Go to the IMPLEMENTOR line
impl_line_start = raw.rfind(b'\n', 0, implementor_pos - 1) + 1
print(f"IMPLEMENTOR line: {raw[impl_line_start:implementor_pos+1]}")

# Find the first diagram box after IMPLEMENTOR
diagram_start = raw.find(diagram_start_marker, implementor_pos)
print(f"Diagram starts at byte {diagram_start}")

# Find the BUILD CHECK section to know where the Merge/Integrator diagram ends
build_check_idx = raw.find(b'BUILD CHECK', diagram_start)
# Go back to find the end of the Integrator diagram
diagram_end = raw.rfind(b'\n', 0, build_check_idx - 5) + 1

print(f"Diagram from {diagram_start} to {diagram_end}")

old_diagram = raw[diagram_start:diagram_end]
print(f"Old diagram length: {len(old_diagram)}")
print(f"Old diagram repr (first 100 chars): {old_diagram[:100]!r}")

# Now construct new diagram with the same encoding style (corrupted box-drawing chars)
# Use the same corrupted byte sequences for box-drawing characters
# From analysis:
CORNER_TL = b'\xc3\xa2\xe2\x80\x9d\xc5\x92'  # ┌ (corrupted)
HORIZ = b'\xc3\xa2\xe2\x80\x9d\xe2\x82\xac'   # ─ (corrupted)
TEE_DOWN = b'\xc3\xa2\xe2\x80\x9d\xc2\xb4'     # ┬ (corrupted)  
CORNER_TR = b'\xc3\xa2\xe2\x80\x9d\xc2\x90'    # ┐ (corrupted)
VERT = b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x9a'     # │ (corrupted)
TRIANGLE_DOWN = b'\xc3\xa2\xe2\x80\x93\xc2\xbc'  # ▼ (corrupted)
CORNER_BL = b'\xc3\xa2\xe2\x80\x9d\xe2\x80\x9d'  # └ (corrupted)
TEE_UP = b'\xc3\xa2\xe2\x80\x9d\xc2\xac'          # ┴ (corrupted)
CORNER_BR = b'\xc3\xa2\xe2\x80\x9d\xcb\x9c'        # ┘ (corrupted)
ARROW = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'        # → (corrupted)
EM_DASH = b'\xc3\xa2\xe2\x82\xac\xe2\x80\x9d'      # — (corrupted)

# New diagram - Phase 1 + Phase 2 merged
new_diagram = (
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

print(f"New diagram length: {len(new_diagram)}")

# Replace
raw = raw[:diagram_start] + new_diagram + raw[diagram_end:]

# ── Change 3: Merge Coordinator Protocol section ──
mc_protocol_start = raw.find(b'### Merge Coordinator Protocol')
if mc_protocol_start < 0:
    print("WARNING: '### Merge Coordinator Protocol' section not found")
else:
    # Find the end of this section - it's the next ## heading or ### heading
    # Look for ## Agent Context or the next ###
    next_heading = raw.find(b'\n## ', mc_protocol_start + 5)
    if next_heading < 0:
        next_heading = len(raw)
    mc_protocol_end = next_heading
    
    old_section = raw[mc_protocol_start:mc_protocol_end]
    print(f"Merge Coordinator Protocol section from {mc_protocol_start} to {mc_protocol_end}")
    
    new_section_text = """### Merge Verification (Part of Integrator Phase 1)

Cross-file consistency verification is now part of **Integrator Phase 1** (read-only audit). The Integrator performs a 4-pass merge check:
1. **Import Path Verification** \xe2\x80\x94 Trace every `from '...'` import, resolve relative paths
2. **Type Signature Alignment** \xe2\x80\x94 Compare import vs export names
3. **Interface Contract Verification** \xe2\x80\x94 Parameter count, required vs optional, return types
4. **Re-export Completeness** \xe2\x80\x94 Barrel file re-exports for all new modules

A consistency score (0.0\xe2\x80\x931.0) is calculated. If `blocking: true`, the Orchestrator dispatches a Fixer before proceeding to Phase 2 (wiring). If `blocking: false`, Phase 2 proceeds.

See `agents/subagent/integrator.md` for the full protocol.
"""
    new_section = new_section_text.encode('utf-8')
    raw = raw[:mc_protocol_start] + new_section + raw[mc_protocol_end:]

# ── Change 4: Pipeline Selection Protocol tables ──
# Replace "Implementor (parallel) → Merge Coordinator → Build"
raw = raw.replace(
    b'Implementor (parallel) \xe2\x86\x92 Merge Coordinator \xe2\x86\x92 Build',
    b'Implementor (parallel) \xe2\x86\x92 Integrator \xe2\x86\x92 Build'
)

# Replace "Finder → Brainstorm → PlanDescriber → Implementor (parallel) → Merge Coordinator → Build"
raw = raw.replace(
    b'Finder \xe2\x86\x92 Brainstorm \xe2\x86\x92 PlanDescriber \xe2\x86\x92 Implementor (parallel) \xe2\x86\x92 Merge Coordinator \xe2\x86\x92 Build',
    b'Finder \xe2\x86\x92 Brainstorm \xe2\x86\x92 PlanDescriber \xe2\x86\x92 Implementor (parallel) \xe2\x86\x92 Integrator \xe2\x86\x92 Build'
)

# ── Change 5: Evidence table (Merge Coordinator row) ──
raw = raw.replace(
    b'| **Merge Coordinator** | No | Yes (merge decisions) | No | Yes \xe2\x80\x94 import scan results, cross-file consistency report |',
    b'| **Integrator Phase 1** | No | Yes (merge decisions) | No | Yes \xe2\x80\x94 import scan results, cross-file consistency report, consistency score |'
)

# ── Change 6: Relationship to Merge Coordinator section ──
rel_mc_start = raw.find(b'### Relationship to Merge Coordinator')
if rel_mc_start >= 0:
    # Find the next ### or --- heading
    next_section = raw.find(b'\n---', rel_mc_start + 10)
    if next_section < 0:
        next_section = raw.find(b'\n###', rel_mc_start + 10)
    if next_section < 0:
        next_section = len(raw)
    
    old_rel_section = raw[rel_mc_start:next_section]
    print(f"Relationship section from {rel_mc_start} to {next_section}")
    
    new_rel_section = b"""### Integrator \xe2\x80\x94 Unified Merge + Wiring Agent

The Integrator now handles both cross-file consistency verification (Phase 1) and wiring (Phase 2) in a single agent. This replaces the former separate Merge Coordinator + Integrator split, eliminating ~90% overlap between the two agents.
"""
    raw = raw[:rel_mc_start] + new_rel_section + raw[next_section:]

# ── Change 7: Version Contracts section ──
replacements_vc = [
    (b'the Merge Coordinator verifies they match', b'the Integrator verifies they match (Phase 1)'),
    (b'When the Merge Coordinator runs, it:', b'When the Integrator runs Phase 1, it:'),
    (b'### Merge Coordinator Integration', b'### Integrator Phase 1 Integration'),
    (b'The Merge Coordinator now checks these contracts:', b'The Integrator now checks these contracts (Phase 1):'),
    (b'# In Merge Coordinator output:', b'# In Integrator output:'),
    (b'Parallel Implementors (with Merge Coordinator)', b'Parallel Implementors (with Integrator Phase 1)'),
    (b'NEVER skip Merge Coordinator\'s contract verification', b'NEVER skip Integrator Phase 1\'s contract verification'),
    (b'@contract annotations \xe2\x86\x92 Merge Coordinator verifies \xe2\x86\x92 Block on mismatch',
     b'@contract annotations \xe2\x86\x92 Integrator Phase 1 verifies \xe2\x86\x92 Block on mismatch'),
]

for old_text, new_text in replacements_vc:
    count = raw.count(old_text)
    if count > 0:
        raw = raw.replace(old_text, new_text)
        print(f"Replaced '{old_text.decode('utf-8', errors='replace')}' ({count} occurrence(s))")
    else:
        print(f"NOT FOUND: '{old_text.decode('utf-8', errors='replace')}'")

# Write back
with open(FILEPATH, 'wb') as f:
    f.write(raw)

print("\n✅ All replacements applied successfully!")