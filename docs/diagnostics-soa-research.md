# State of the Art: Diagnostic Reporting Research

A review of best practices in compiler/tool error messages with a user-centric
focus.

---

## Executive Summary

The best diagnostic systems share common principles:

1. **Show the code** - Put the user's code front and center
2. **Point precisely** - Visual markers showing exactly where the problem is
3. **Explain why** - Not just what's wrong, but why it matters
4. **Suggest fixes** - Actionable, copy-pasteable solutions
5. **Respect the user** - Polite, helpful tone; never blame

---

## Language Case Studies

### Elm: The Pioneer

Elm, created by Evan Czaplicki, revolutionized compiler error messages and
directly influenced Rust's approach.

**Core Philosophy:**

> "One of Elm's goals is to change our relationship with compilers. Compilers
> should be assistants, not adversaries."

**Key Design Decisions:**

1. **Compiler as Teacher** - Error messages actively help you learn the language
2. **Examples in Errors** - Show correct usage alongside the error
3. **Links to Documentation** - Deep links to relevant docs
4. **No Cascading Errors** - Fix one thing at a time, don't overwhelm
5. **Survivorship Bias** - Prioritize helping newcomers, not just experts

**Example Elm Error:**

```
-- TYPE MISMATCH -------------------------------------------------- src/Main.elm

The 2nd argument to `viewUser` is not what I expect:

45|   viewUser model user
                    ^^^^
This `user` value is a:

    Maybe User

But `viewUser` needs the 2nd argument to be:

    User

Hint: Use Maybe.withDefault or case to handle the Maybe
```

**What makes it great:**

- Header tells you the category (TYPE MISMATCH)
- Shows YOUR code with the problem underlined
- Explains what it found vs what it expected
- Gives a concrete hint for how to fix it

Sources:

- [Elm: Compiler Errors for Humans](https://elm-lang.org/news/compiler-errors-for-humans)
- [Elm 0.19.1 Improved Syntax Error Messages](https://www.packtpub.com/en-us/learning/how-to-tutorials/elm-0-19-1-releases-improved-syntax-error-messages-elm-compiler/)

---

### Rust: Industrial-Strength Elm Ideas

Rust explicitly credits Elm as inspiration and has invested heavily in error UX.

**Design Goals (from RFC 1644):**

- Work well for new developers, post-onboarding, AND experts
- No special configuration needed for good errors
- Draw inspiration from Elm, Dybuk, and other improved systems

**Key Innovations:**

1. **Primary vs Secondary Spans** - Main error location + related context
2. **Error Codes** - `E0308` links to detailed explanations (`--explain E0308`)
3. **Suggestions with Diffs** - Machine-applicable fixes
4. **Multi-line Spans** - Handle complex cases gracefully
5. **Color + ASCII Art** - Visual hierarchy without requiring special fonts

**Example Rust Error:**

```
error[E0308]: mismatched types
 --> src/main.rs:4:18
  |
4 |     let x: i32 = "hello";
  |            ---   ^^^^^^^ expected `i32`, found `&str`
  |            |
  |            expected due to this
  |
help: if you want to convert a `&str` to `i32`, use `parse`
  |
4 |     let x: i32 = "hello".parse().unwrap();
  |                         +++++++++++++++++
```

**What makes it great:**

- Error code for looking up detailed explanation
- Shows the line with column-precise pointer
- Secondary span shows WHY it expected i32
- `help:` section gives copy-pasteable fix with diff markers

Sources:

- [Shape of Errors to Come - Rust Blog](https://blog.rust-lang.org/2016/08/10/Shape-of-errors-to-come/)
- [RFC 1644: Default and Expanded Rustc Errors](https://rust-lang.github.io/rfcs/1644-default-and-expanded-rustc-errors.html)
- [Rust New Error Format Proposal](https://github.com/jonathandturner/rust_proposals/blob/master/rust_new_error_format.md)

---

### Gleam: Simplicity + Quality

Gleam is a newer functional language that has earned praise for error message
quality.

**Philosophy:**

> "Gleam is designed to make your job as fun and stress-free as possible."

**Design Approach:**

- Static analysis and editor tooling to reduce mental load
- Language kept intentionally small so errors are predictable
- No null, no exceptions - fewer error categories to handle

**Example Gleam Error:**

```
error: Unknown record field
  --> src/main.gleam:5:10
   |
 5 |   user.nme
   |        ^^^ Did you mean `name`?
   |
   Available fields: name, email, age
```

**What makes it great:**

- Fuzzy matching to suggest "Did you mean...?"
- Lists available options so you can pick the right one
- Error caught at compile time, not runtime

Source: [Gleam Programming Language](https://gleam.run/)

---

### Unison: Structured Refactoring

Unison takes a unique approach where the codebase is always in a valid state.

**Key Innovation:**

> "Your codebase is always live and typechecks, even in the middle of a
> refactoring. Unison has structured refactoring sessions, not a big misleading
> list of type errors."

**Design Decisions:**

- No cascading errors - you fix one thing, then the next
- Errors include the actual value that caused the problem
- Clear disambiguation when names are ambiguous

**Example:** When `sort` is ambiguous, Unison shows:

```
I found multiple definitions for `sort`:
  - Heap.sort
  - List.sort

Specify which one you mean.
```

Source: [Unison Language](https://www.unison-lang.org/)

---

### Roc: Elm's Spiritual Successor

Roc, created by Richard Feldman (former Elm core team), continues the tradition.

**Design Decision - No Default Currying:**

> "Currying lowers error message quality, because there can no longer be an
> error for 'function called with too few arguments.' Instead, the error you get
> will be some other type mismatch, and you have to figure out the real
> problem."

This shows how language design choices directly impact error quality.

Source: [Roc FAQ](https://www.roc-lang.org/faq)

---

## Rust Ecosystem: Diagnostic Libraries

### ariadne

A library for creating beautiful compiler diagnostics in Rust.

**Features:**

- Inline and multi-line labels with arbitrary span configurations
- Color generation for distinct visual elements
- Automatic ordering/overlap heuristics to avoid label crossover
- Customizable tab width, label attach points, underlines

**Example Output:**

```
Error: Incompatible types
   --> src/main.rs:5:9
    |
  5 |     foo(a, b)
    |         - ^
    |         | |
    |         | This is of type `str`
    |         |
    |         This is of type `i32`
    |
    = note: expected `i32`, found `str`
```

Source: [ariadne on GitHub](https://github.com/zesterer/ariadne)

### miette

> "Fancy diagnostic reporting library for us mere mortals who aren't compiler
> hackers."

**Features:**

- Fancy Unicode rendering
- Screen-reader/braille support (respects NO_COLOR)
- Customizable theming
- Clickable error codes in supported terminals
- Syntax highlighting via syntect
- Works with thiserror

**Philosophy:** Miette brings Rust's excellent error reporting philosophy to
YOUR projects, not just the Rust compiler itself.

Source: [miette on GitHub](https://github.com/zkat/miette)

---

## Academic Research

### Foundational Paper

**"On Compiler Error Messages: What They Say and What They Mean"**
(Traver, 2010)

Published in _Advances in Human-Computer Interaction_, this paper studies error
messages from an HCI perspective.

Key findings:

- Compiler technology has historically not prioritized error messages
- Messages should be studied as a user interface problem
- The gap between what compilers say and what users understand is significant

Source:
[Wiley Online Library](https://onlinelibrary.wiley.com/doi/10.1155/2010/602570)

---

### Readability Research

**"On Designing Programming Error Messages for Novices: Readability and its
Constituent Factors"** (CHI 2021)

Key insight:

> "There is still no definition of what makes a programming error message
> 'readable,' and therefore no usable metric for assessing message readability."

The paper calls for research on readability as a prerequisite for improving
design.

Source:
[ACM Digital Library](https://dl.acm.org/doi/fullHtml/10.1145/3411764.3445696)

---

### Comprehensive Literature Review

**"Compiler Error Messages Considered Unhelpful: The Landscape of Text-Based
Programming Error Message Research"** (ITiCSE 2019)

A massive review of **307 papers** on programming error messages.

Key findings on why enhanced error messages sometimes don't help:

1. Students don't read them
2. Researchers are measuring the wrong outcomes
3. Effects are hard to measure
4. Messages aren't properly designed
5. Messages are well-designed but students don't understand them in context
   (increased cognitive load)

Source: [ITiCSE 2019 Working Group](https://iticse19-wg10.github.io/)

---

### Eye-Tracking Studies

**"How Do Programming Students Read and Act upon Compiler Error Messages?"**
(HCII 2023)

Uses eye-tracking to understand how students actually read error messages. Key
for understanding what parts of errors people focus on.

Source:
[Springer](https://link.springer.com/chapter/10.1007/978-3-031-35017-7_11)

---

## UX Design Principles

From Nielsen Norman Group and UX research:

### Core Principles

1. **Visibility** - Errors must be noticeable
2. **Constructive** - Offer solutions, not just problems
3. **Respect User Effort** - Don't make them start over
4. **Precise Location** - Point to exactly what's wrong
5. **Human Language** - No jargon or codes without explanation

### Actionable Messages

> "An error message should not just state the problem; it should also offer a
> way to fix it."

Best practice: If possible, guess the correct action and offer it as a one-click
fix.

### Brevity Matters

Research shows:

- 14 words or less: users understand 90%
- 8 words or less: users understand 100%

### Don't Blame the User

> "Users are already frustrated when they get an error message - don't make it
> worse by placing blame on them."

Avoid: "You entered an invalid email" Better: "Please enter a valid email
address (e.g., name@example.com)"

Sources:

- [NN/g Error Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/)
- [Smashing Magazine: Error Messages UX](https://www.smashingmagazine.com/2022/08/error-messages-ux-design/)
- [Temporal: Write Errors That Don't Make Me Think](https://temporal.io/blog/error-message-design)

---

## IDE Integration Patterns

### Visual Studio: Light Bulbs

Three types of indicators:

- **Screwdriver** - Suggested improvement (optional)
- **Yellow bulb** - Recommended action (non-critical)
- **Red bulb** - Required fix (critical error)

Quick Actions provide inline fixes without leaving the editor.

Source:
[Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/ide/quick-actions)

### IntelliJ: Intentions vs Quick-Fixes

Distinction between:

- **Quick-fixes** - Fix problems (errors, warnings)
- **Intentions** - Improve code (optimizations, transformations)

Both appear as context actions with different visual indicators.

Source:
[JetBrains Documentation](https://www.jetbrains.com/help/idea/intention-actions.html)

### GitHub Actions Annotations

CI systems can emit structured annotations:

```
::error file=src/main.rs,line=42::Type mismatch: expected i32, found str
```

These appear inline in PR diffs, connecting errors to code.

---

## TypeScript: The Ongoing Challenge

TypeScript error messages are notoriously difficult to read, leading to:

### pretty-ts-errors Extension

> "At some point, TypeScript will throw on you a shitty heap of parentheses and
> '...'. This extension will help."

Features:

- Syntax highlighting for types in errors
- Navigation to type declarations
- Links to ts-error-translator for plain English

Source:
[pretty-ts-errors on GitHub](https://github.com/yoavbls/pretty-ts-errors)

### TS2322 Improvement Proposal

Orta (TypeScript team) proposed a new format specifically for the most common
error:

> "The 'type x is not assignable to y' error - the most seen error message by
> far."

The proposal suggests breaking the existing pattern for this one error to
provide better visual display.

Source:
[Orta's Gist](https://gist.github.com/orta/f80db73c6e8211211e3d224a5ab47624)

---

## Key Takeaways for Steady

### From Elm/Rust

- Put user's code front and center
- Use visual markers (underlines, carets) for precise location
- Separate "what I found" from "what I expected"
- Include hints with actionable fixes
- Link to detailed documentation

### From Academic Research

- Readability is under-researched but critical
- Students often don't read error messages - make them scannable
- Cognitive load matters - don't overwhelm with multiple errors
- Eye-tracking shows people focus on specific parts - optimize those

### From UX Research

- Keep messages under 14 words when possible
- Always offer a path forward
- Never blame the user
- Use examples of correct input

### From IDE Patterns

- Distinguish severity visually (error vs warning vs suggestion)
- Offer one-click fixes when possible
- Integrate with CI systems via structured annotations

### From Diagnostic Libraries

- Invest in visual rendering (colors, Unicode boxes)
- Support accessibility (NO_COLOR, screen readers)
- Make error codes clickable/linkable
- Handle multi-line spans gracefully

---

## Design Checklist for Steady Diagnostics

Based on this research, each Steady diagnostic should:

- [ ] Show the user's actual request/data
- [ ] Point precisely to the problem location
- [ ] Explain expected vs actual clearly
- [ ] Provide a concrete, copy-pasteable fix
- [ ] Link to the spec location
- [ ] Use consistent visual formatting
- [ ] Be scannable (key info in first 8-14 words)
- [ ] Never blame the user
- [ ] Support multiple output contexts (CLI, CI, JSON, headers)
- [ ] Respect NO_COLOR and accessibility needs
