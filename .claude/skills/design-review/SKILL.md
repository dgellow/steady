---
name: design-review
description: Review a design/spec document by finding real-world patterns that stress it
argument-hint: <path-to-design-doc>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
---

# Design Review

Review a design or specification document against real-world patterns in the codebase.

## Process

### Step 1: Understand the Design
Read the design document at `$ARGUMENTS` in its entirety. Do not assume prior knowledge.
Pay close attention to:
- Intent and goals (what problem is being solved?)
- Core concepts and models
- Categories, classifications, or taxonomies
- Confidence levels or open questions noted by the author

### Step 2: Understand the Problem Domain
Trace the existing codebase to understand how the system currently works. This is NOT to compare implementation to spec—the implementation may change. This is to understand:
- Edge cases the design must handle
- Current patterns and how they flow
- Integration points with external systems

Search for relevant code using Glob and Grep. Look for:
- Core logic related to the design's domain
- Error handling and validation
- Test fixtures and edge case tests

### Step 3: Find Real Problematic Patterns
Search the codebase for concrete examples that would stress the design:
- Test fixtures with intentionally difficult cases
- Edge case tests
- Real failures from test runs (log files, output captures)
- Integration tests with external systems

### Step 4: Evaluate Design Against Patterns
For each problematic pattern found:
1. How would the design handle this case?
2. What category/classification applies?
3. What would the output look like?
4. Is the design unclear, insufficient, or missing coverage?

## Output Format

```markdown
## Design Review: [Document Name]

### Summary
[2-3 sentence assessment of design soundness]

---

## Concrete Scenarios Found

### 1. [Pattern Name] (source)
**Scenario**: [What the pattern is]
**Actual data**: [Real example if available]
**How design handles**: [Section, category, or classification that applies]
**Problem**: [Gap, ambiguity, or incorrect handling]
**Recommendation**: [Specific fix]

[Repeat for each significant pattern]

---

## Design Strengths
[What the design gets right, validated by real patterns]

---

## Recommended Changes

### [Category]
| Item | Description | Rationale |
|------|-------------|-----------|
| ... | ... | ... |
```

## What NOT to Output

- Implementation gaps ("X isn't built yet")
- Implementation tasks ("implement Y")
- Comparison of spec to current code behavior
- Time estimates

Focus on **design completeness and correctness**, not implementation status.
