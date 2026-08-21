# Hatua

An embeddable workflow designer. Read `CONTEXT.md` for the domain language,
`docs/adr/` for the decisions that constrain the code, and `docs/handoff.md` for
the design of record — what each region is, and why it is that shape.

## Rules

This module has prescriptive rules in `.agents/rules/`. **Read every file in that directory before making changes here, and follow each rule strictly.**
Each file contains one rule. New rules go in that directory — one file per rule, kebab-case filename matching the rule's intent.
