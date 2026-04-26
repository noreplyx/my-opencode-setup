---
name: quality-assurance
description: Expert skill for ensuring software quality through comprehensive testing, bug discovery, and adherence to quality standards.
---

# Quality Assurance Skill

This skill provides a rigorous framework for validating software correctness, stability, performance, and security.

## Testing Domains

When performing quality assurance, apply the following testing methodologies:

### 1. Functional Testing
- **Goal**: Verify that the software behaves according to the specified requirements.
- **Approach**: Execute a set of test cases based on functional specifications to ensure each feature works as intended.

### 2. Regression Testing
- **Goal**: Ensure that new changes have not broken existing functionality.
- **Approach**: Re-run a suite of previously passed tests after every significant code change or bug fix.

### 3. Integration Testing
- **Goal**: Verify that different modules or services work together correctly.
- **Approach**: Test the interfaces and data flow between components, APIs, and external dependencies.

### 4. Performance Testing
- **Goal**: Evaluate the responsiveness, stability, and scalability under a particular workload.
- **Approach**: Conduct load testing, stress testing, and latency analysis to identify bottlenecks.

### 5. Security Testing
- **Goal**: Identify vulnerabilities and ensure the system is protected against attacks.
- **Approach**: Perform input validation checks, authentication/authorization audits, and search for common vulnerabilities (e.g., OWASP top 10).

## Bug Discovery & Issue Tracking
- **Finding Bugs**: Proactively explore "edge cases," "happy paths," and "error paths" to uncover hidden defects.
- **Issue Reporting**: Clearly document discovered bugs with:
    - Steps to reproduce
    - Expected vs. Actual behavior
    - Log traces and environment details
    - Severity and Priority

## Quality Standards
Adhere to the following quality benchmarks:
- **Test Coverage**: Maintain high branch and line coverage.
- **Clean Code**: Ensure code follows project linting and style guidelines.
- **Stability**: No regressions in core functionality.
- **Performance**: Meet defined SLAs (e.g., API response time < 200ms).
- **Security**: Zero critical or high-severity vulnerabilities in production code.
