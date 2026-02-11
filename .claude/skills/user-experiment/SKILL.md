---
name: user-experiment
description: Run a human user experiment to find UX friction in Steady
argument-hint: <sdk-name e.g. sink-python>
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - WebFetch
---

# User Experiment

Simulate being a real user of Steady to discover UX friction, confusing output,
missing diagnostics, and gaps in the developer experience.

## The Mindset

**You are NOT a Steady developer.** You are an SDK developer who:

- Has never read Steady's source code
- Doesn't know how the response generator works
- Doesn't know what diagnostics exist or how they're triggered
- Just wants their SDK tests to pass
- Will read terminal output, try suggested commands, and curl endpoints

**Your only tools are what a real user has:**

- The SDK's `./scripts/test` command
- The mock server's terminal output and log file (`.steady.log`)
- `curl` to inspect endpoints
- Commands that Steady suggests in its output (e.g., `steady validate`,
  `steady explain`)
- Response headers (`x-steady-*`)
- The OpenAPI spec YAML

**You must NOT:**

- Read Steady source code to understand behavior
- Use knowledge of how the generator, validator, or diagnostics work
- Skip steps a real user would have to do
- Grep Steady's codebase for answers

## Process

### Step 1: Run the Tests

Run the SDK tests exactly as a developer would:

```bash
cd sdk-tests/$ARGUMENTS
./scripts/test
```

Capture the full output. Do NOT `tail` or filter — experience the actual output
volume. Note how long it takes, how much output there is, and whether the
failure summary is easy to find.

### Step 2: Read the Failure Output

Look at the pytest output as a developer would:

- Can you immediately tell how many tests failed?
- Can you find the actual error messages in the output?
- Do the error messages tell you what went wrong?
- Can you tell if the failure is in your SDK code or the mock server?

Document what you learn and what's confusing.

### Step 3: Check the Mock Server

Look at `.steady.log`:

- Does the startup output make sense?
- Are there any warnings or errors related to your failing tests?
- Do the request logs for failing endpoints show any issues?
- Are there any hints about what to do next?

Try any commands that Steady suggests (e.g., `steady validate`,
`steady explain`). Do they help you understand the failures?

### Step 4: Investigate the Failures

For each distinct failure category, try to understand what went wrong using only
the tools a real user has:

1. `curl` the failing endpoint to see the actual response
2. Check response headers for clues (`x-steady-valid`,
   `x-steady-example-source`, `x-steady-error-count`)
3. Read the relevant section of the OpenAPI spec
4. Compare what the spec says vs what the mock returned

**Time yourself mentally** — how long did it take to figure out the root cause?
What steps were unnecessary? What information was missing that would have saved
time?

### Step 5: Write the Report

Organize findings into these categories:

#### A. What Worked Well

Things that helped you understand the situation. Be specific — "the startup
message was clear" is weak; "the startup message told me 6 warnings existed and
suggested `steady validate` to see details" is strong.

#### B. Friction Points

For each friction point:

- **What happened**: The specific moment of confusion or wasted time
- **What I expected**: What output or behavior would have helped
- **Severity**: How much time/effort was wasted
  - **High**: Could not diagnose without reading Steady source code
  - **Medium**: Took significant manual investigation (curl, spec reading)
  - **Low**: Minor annoyance, figured it out quickly

#### C. Missing Diagnostics

Spec or response issues that Steady could detect but doesn't. For each:

- What the issue is
- Why it matters (what failure it causes)
- What a diagnostic could look like

#### D. Actionable Recommendations

Concrete improvements, ordered by impact. For each:

- What to change
- Why it helps (which friction point it addresses)
- Rough scope (one-liner, small feature, significant work)

## What Makes a Good Experiment

- **Honesty over thoroughness.** If something is genuinely confusing, say so. If
  something works well, say that too. Don't inflate issues or minimize
  strengths.
- **Specifics over generalities.** "The output is confusing" is useless. "The
  request log shows 200 OK with no diagnostics for an endpoint returning `{}`"
  is actionable.
- **Time sensitivity.** Note when you had to do something that took a lot of
  effort. A developer's time is the scarcest resource.
- **Don't propose solutions during the experiment.** Observe and document first.
  Recommendations come at the end, informed by the full experience.

## Output Format

```markdown
## User Experiment: [SDK Name]

### Test Run Summary

- Total: X passed, Y failed, Z skipped
- Runtime: ~Ns
- Output volume: [manageable / overwhelming / truncated]

### What Worked Well

1. [Specific positive observation]
2. ...

### Friction Points

#### 1. [Short title] — Severity: High/Medium/Low

**What happened**: ... **What I expected**: ... **Time spent**: ...

#### 2. ...

### Missing Diagnostics

#### 1. [Potential diagnostic]

**Issue**: ... **Impact**: ... **Suggested diagnostic**: ...

### Recommendations

| # | Change | Addresses | Scope |
| - | ------ | --------- | ----- |
| 1 | ...    | ...       | ...   |
```
