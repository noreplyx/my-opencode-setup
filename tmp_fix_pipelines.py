#!/usr/bin/env python3
"""Fix the pipeline table lines with corrupted arrows"""

FILEPATH = '/home/oat/.config/opencode/skills/orchestration/SKILL.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

corrupt_arrow = b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99'

# Fix: "Implementor (parallel) → Merge Coordinator → Build → Lint → Security → QA → Verifier"
old1 = b'Implementor (parallel) ' + corrupt_arrow + b' Merge Coordinator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier'
new1 = b'Implementor (parallel) ' + corrupt_arrow + b' Integrator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier'

count1 = raw.count(old1)
print(f"Pattern Short Pipeline (with → Documentor): {count1}")
if count1 > 0:
    raw = raw.replace(old1, new1)
    print("Fixed short pipeline")

# Fix: "PlanDescriber → Implementor (parallel) → Merge Coordinator → Build → ... → Documentor"
old2 = b'PlanDescriber ' + corrupt_arrow + b' Implementor (parallel) ' + corrupt_arrow + b' Merge Coordinator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier ' + corrupt_arrow + b' Documentor'
new2 = b'PlanDescriber ' + corrupt_arrow + b' Implementor (parallel) ' + corrupt_arrow + b' Integrator ' + corrupt_arrow + b' Build ' + corrupt_arrow + b' Lint ' + corrupt_arrow + b' Security (incl. semgrep) ' + corrupt_arrow + b' QA ' + corrupt_arrow + b' Verifier ' + corrupt_arrow + b' Documentor'

count2 = raw.count(old2)
print(f"Pattern Full Pipeline: {count2}")
if count2 > 0:
    raw = raw.replace(old2, new2)
    print("Fixed full pipeline")

# Final verification
remaining = []
idx = 0
while True:
    idx = raw.find(b'Merge Coordinator', idx)
    if idx < 0:
        break
    remaining.append(idx)
    idx += 1

print(f"\nTotal remaining 'Merge Coordinator' references: {len(remaining)}")
for pos in remaining:
    start = max(0, pos - 30)
    end = min(len(raw), pos + 80)
    print(f"  At {pos}: {raw[start:end]}")

# Verify the intentional ones are kept
# "former Merge Coordinator" at ~6803 and ~111991
assert raw.count(b'former Merge Coordinator') >= 2, "Intentional references missing!"

with open(FILEPATH, 'wb') as f:
    f.write(raw)

print(f"\n✅ Done")