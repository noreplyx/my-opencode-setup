# Changelog

All notable changes to the OpenCode AI Agent System are documented in this file.

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
