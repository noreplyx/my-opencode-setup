# Changelog

All notable changes to the OpenCode AI Agent System are documented in this file.

## [2.4.0] - 2026-06-05

### Added
- **Mandatory Gates Policy**: PlanDescriber, Security Scan Gate, and Verifier Gate are now mandatory for EVERY pipeline that creates or modifies code
- **Pipeline Type Quick Selection table** (`README.md`, `orchestrator.md`): Quick-reference table mapping task types to pipelines with gate enforcement
- **Security-hardened pipeline sequences** in `pipeline-registry.md`: Fixer-only and trivial pipelines now enforce Security Scan + Verifier gates
- **Parallel pipeline security**: Both branches of parallel pipelines now independently run Security Scan + Verifier before merge

### Changed
- **pipeline-registry.md**: Added Mandatory Gates Policy section, updated all pipeline sequences to enforce PlanDescriber + Security Scan + Verifier
- **orchestrator.md**: Added Mandatory Gates Policy section with enforcement rules
- **README.md**: Replaced "Skip Shortcuts" with comprehensive Pipeline Type Quick Selection table showing gate enforcement per pipeline type

### Security
- Hardened fixer-only pipeline: now runs Security Scan + Verifier
- Hardened trivial pipeline: now runs PlanDescriber + Security Scan + Verifier (minimum)
- Parallel pipelines now enforce Security Scan + Verifier on each branch independently

## [2.3.0] - 2026-06-05

### Added
- **Architect agent** (`agents/subagent/architect.md`): New subagent for system architecture design, ADRs, C4 diagrams, and trade-off analysis
- **Debug agent** (`agents/subagent/debug.md`): Deep diagnostic agent called after Fixer exhausts 3 attempts
- **Pipeline registry** (`skills/orchestration/references/pipeline-registry.md`): Canonical index of all pipeline types, agent sequences, required scripts, and expected outputs
- **OSV-Scanner integration**: Open source vulnerability scanner auto-loaded during Security Scan gate
- **PlanDescriber quality feedback loop**: Plan quality scores auto-escalate to user when PlanDescriber quality drops below 70%
- **PlanDescriber qa-workflow skill**: PlanDescriber now loads `qa-workflow` to include test checkpoints aligned with QA standards

### Changed
- **orchestrator.md**: Fixed encoding artifacts (UTF-8 misinterpretation of em dash, book emoji, arrow characters)
- **orchestrator.md**: Added OSV-Scanner to security gate flow and skill permissions
- **orchestrator.md**: Added PlanDescriber quality feedback loop documentation
- **orchestrator.md**: Added pipeline-registry.md to modular reference docs list
- **README.md**: Updated pipeline diagram to match canonical order with all gates
- **README.md**: Added Architect and Debug agents to agent roles table
- **README.md**: Updated Security Scan gate to include OSV-Scanner
- **README.md**: Added PlanDescriber quality feedback loop section
- **README.md**: Updated script inventory to list all 31 scripts with descriptions
- **README.md**: Added OSV-Scanner to built-in skills table
- **README.md**: Added Pre-Flight, Plan Contract, Acceptance, Security Test Coverage, and Evidence gates to validation gates table

### Fixed
- **verifier.md**: Removed duplicate `security-scan` skill permission (was listed twice)
- **qa.md**: Removed duplicate `security-scan` skill permission (was listed twice)
- **implementor.md**: Removed `task: true` and `subagent/browser-tester` permission -- dispatch centralized at Orchestrator
- **architect.md**: Removed `task: true` and `subagent/finder` permission -- dispatch centralized at Orchestrator
- **plandescriber.md**: Added `qa-workflow` to skill permissions for test checkpoint awareness

### Security
- OSV-Scanner now auto-loaded during Security Scan gate for open source vulnerability scanning
- Pre-flight security checks include lockfile integrity and npm audit signatures

