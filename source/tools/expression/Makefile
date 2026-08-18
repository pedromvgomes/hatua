# The expression toolchain.
#
# Language and destination are arguments, not baked in:
#
#   make build                  both languages: generate -> verify -> promote
#   make build LANG=go          one
#   make build LANG=ts OUT=../../packages/expressions/src/generated
#   make check-drift            CI: generate -> verify -> diff, never promote
#   make test                   the scenarios, against what is already committed
#   make lint                   the shared-subset check on the grammar alone

# Plain `=`, not `?=`: a makefile assignment overrides the environment, and
# LANG is already set there to a locale on virtually every machine. A
# command-line `make build LANG=go` still wins over both.
LANG =
OUT  =

ARGS := $(if $(LANG),--lang $(LANG)) $(if $(OUT),--out $(OUT))

.PHONY: build check-drift test lint

build:
	@node src/build.js $(ARGS)

check-drift:
	@node src/build.js --check-drift $(ARGS)

test:
	@node harness/run.js $(if $(LANG),--lang $(LANG))

lint:
	@node src/lint-grammar.js
