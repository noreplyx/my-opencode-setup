#!/usr/bin/env python3
"""Fix remaining Merge Coordinator references in SKILL.md"""

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

changes = 0

# Fix 1: Line 83 in diagram - "re-run Merge Coordinator" → "re-run Integrator Phase 1"
# But this was in the diagram we already replaced, so it should be gone now
# Let me check
remaining = [(b'MERGE COORDINATOR', 'MERGE COORDINATOR'),
             (b'merge_coordinator', 'merge_coordinator'),
             (b'merge-coordinator', 'merge-coordinator'),
             (b'merge coordinator', 'merge coordinator')]

for term_bytes, term_name in remaining:
    count = raw.count(term_bytes)
    if count > 0:
        print(f"'{term_name}' found {count} time(s)")
    
# Fix: "dispatch sequentially unless using a Merge Coordinator"  
old1 = b'dispatch sequentially unless using a Merge Coordinator'
if old1 in raw:
    raw = raw.replace(old1, b'dispatch sequentially unless using an Integrator (Phase 1 merge check)')
    changes += 1
    print("Fixed: 'using a Merge Coordinator'")
else:
    print("NOT FOUND: 'using a Merge Coordinator'")

# Fix: Pipeline table lines - these use different arrow characters
# "Implementor (parallel) → Merge Coordinator → Build"
# The arrow might be \xe2\x86\x92 (→)
old2 = b'Implementor (parallel) \xe2\x86\x92 Merge Coordinator \xe2\x86\x92 Build'
# This was already replaced earlier, let me check
if old2 in raw:
    raw = raw.replace(old2, b'Implementor (parallel) \xe2\x86\x92 Integrator \xe2\x86\x92 Build')
    changes += 1
    print("Fixed: Pipeline table arrow (→)")
    
# Try alternative arrow character - might be a different encoding
old2b = b'Implementor (parallel) \xe2\x80\x93 Merge Coordinator \xe2\x80\x93 Build'
if old2b in raw:
    raw = raw.replace(old2b, b'Implementor (parallel) \xe2\x80\x93 Integrator \xe2\x80\x93 Build')
    changes += 1
    print("Fixed: Pipeline table arrow (–)")

# Try with plain dash
old2c = b'Implementor (parallel) - Merge Coordinator - Build'
if old2c in raw:
    raw = raw.replace(old2c, b'Implementor (parallel) - Integrator - Build')
    changes += 1
    print("Fixed: Pipeline table arrow (-)")

# Fix: "Finder → Brainstorm → PlanDescriber → Implementor (parallel) → Merge Coordinator → Build"
old3 = b'Finder \xe2\x86\x92 Brainstorm \xe2\x86\x92 PlanDescriber \xe2\x86\x92 Implementor (parallel) \xe2\x86\x92 Merge Coordinator \xe2\x86\x92 Build'
if old3 in raw:
    raw = raw.replace(old3, b'Finder \xe2\x86\x92 Brainstorm \xe2\x86\x92 PlanDescriber \xe2\x86\x92 Implementor (parallel) \xe2\x86\x92 Integrator \xe2\x86\x92 Build')
    changes += 1
    print("Fixed: Full pipeline arrow (→)")

# Fix: Evidence table row for Merge Coordinator
old4 = b'| **Merge Coordinator** |'
if old4 in raw:
    # Find this specific row and replace it
    idx = raw.find(old4)
    # Find the end of this row (next | character at start of line)
    line_end = raw.find(b'\r\n', idx)
    old_line = raw[idx:line_end]
    print(f"Evidence table line: {old_line!r}")
    raw = raw[:idx] + b'| **Integrator Phase 1** | No | Yes (merge decisions) | No | Yes \xe2\x80\x94 import scan results, cross-file consistency report, consistency score |' + raw[line_end:]
    changes += 1
    print("Fixed: Evidence table row")

# Fix: Evidence contract table (line 2167)
old5 = b'| **Merge Coordinator** | 1 per file pair checked | Import resolution evidence for each cross-file check |'
if old5 in raw:
    raw = raw.replace(old5, b'| **Integrator (Phase 1)** | 1 per file pair checked | Import resolution evidence for each cross-file check |')
    changes += 1
    print("Fixed: Evidence contract table")
else:
    print("NOT FOUND: Evidence contract table exact match")
    # Try with different whitespace
    for offset in range(len(raw)):
        if raw[offset:offset+20] == b'**Merge Coordinator**':
            print(f"Found **Merge Coordinator** at offset {offset}")
            snippet = raw[offset-10:offset+80]
            print(f"Context: {snippet!r}")

# Fix: Version Contracts table - "Merge Coordinator checks contracts"
old6 = b'Merge Coordinator checks contracts'
if old6 in raw:
    raw = raw.replace(old6, b'Integrator Phase 1 checks contracts')
    changes += 1
    print("Fixed: Version Contracts table 'checks contracts'")

# Fix: @contract annotations → Merge Coordinator verifies → Block on mismatch
# Try the arrow character
old7 = b'@contract annotations \xe2\x86\x92 Merge Coordinator verifies \xe2\x86\x92 Block on mismatch'
if old7 in raw:
    raw = raw.replace(old7, b'@contract annotations \xe2\x86\x92 Integrator Phase 1 verifies \xe2\x86\x92 Block on mismatch')
    changes += 1
    print("Fixed: @contract arrow (→)")
else:
    print("NOT FOUND: @contract arrow (→)")
    # Try other arrow variants
    for try_arrow in [b'\xe2\x80\x93', b'\xef\xbc\x9e', b' -> ', b' --- ', b'\xe2\x86\x92']:
        test = b'@contract annotations ' + try_arrow + b' Merge Coordinator verifies ' + try_arrow + b' Block on mismatch'
        if test in raw:
            raw = raw.replace(test, b'@contract annotations ' + try_arrow + b' Integrator Phase 1 verifies ' + try_arrow + b' Block on mismatch')
            changes += 1
            print(f"Fixed: @contract arrow (alternative arrow {try_arrow!r})")
            break
    else:
        # Search for any occurrence of "Merge Coordinator verifies" near @contract
        mc_verify = raw.find(b'Merge Coordinator verifies')
        if mc_verify >= 0:
            print(f"Found 'Merge Coordinator verifies' at offset {mc_verify}")
            context_start = max(0, mc_verify - 40)
            context_end = min(len(raw), mc_verify + 80)
            print(f"Context: {raw[context_start:context_end]!r}")

# Final check for remaining MERGE COORDINATOR (case insensitive)
import re
remaining = [(b'MERGE COORDINATOR', 'MERGE COORDINATOR'),
             (b'merge-coordinator', 'merge-coordinator'),
             (b'merge_coordinator', 'merge_coordinator')]
for term_bytes, term_name in remaining:
    count = raw.count(term_bytes)
    if count > 0:
        print(f"\n⚠️  REMAINING '{term_name}' found {count} time(s)")
    else:
        print(f"✅ '{term_name}' - all occurrences replaced")

with open(FILEPATH, 'wb') as f:
    f.write(raw)

print(f"\n✅ Done: {changes} changes applied")