// Package hatua is the Go SDK for Hatua workflows.
//
// It exists mainly so a runner does not have to reimplement the contract or the
// expression language. A runner that evaluates a reference differently from the
// builder produces the worst possible failure: a workflow that looks correct in
// the editor and does the wrong thing in production.
//
// # Where this code lives
//
// The source of truth is github.com/pedromvgomes/hatua, under source/sdk/go/.
// It is developed there alongside the schemas so that a contract change and its
// SDK update land in one commit.
//
// github.com/pedromvgomes/hatua-go is a generated, read-only mirror. It exists
// only so hatua.dev/go resolves: Go locates a module by subtracting the import
// path from the repository root, which means a module named hatua.dev/go has to
// sit at the root of the repository it is fetched from. The mirror is
// force-pushed from the monorepo at release time with git subtree split.
//
// Issues and pull requests belong on the monorepo. Commits pushed directly to
// the mirror are lost on the next release.
package hatua
