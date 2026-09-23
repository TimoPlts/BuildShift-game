# Architecture Decision Records (ADRs)

This folder stores **Architecture Decision Records** for significant technical
decisions made in the BuildShift project.

An ADR is a short document that captures:

- The context and problem being solved.
- The options that were considered.
- The decision that was made.
- The consequences of that decision (positive, negative, and neutral).

ADRs are created only when a **significant, hard-to-reverse** decision is made
(e.g. a new technology choice, a major architecture change, or a trade-off that
affects multiple packages). Small, day-to-day implementation choices do not
need an ADR.

## Naming convention

Use a sequential, zero-padded number prefixed with a short slug:

```
0001-example-decision.md
```

## Status

No ADRs have been created yet. The initial technology decisions are already
captured in [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md) as
the locked architecture baseline.
