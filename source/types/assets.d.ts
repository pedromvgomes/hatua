/**
 * Ambient module declarations shared across the workspace.
 *
 * Packages resolve to each other's source (ADR-0004), so a package that
 * typechecks @hatua/react needs these too — hence workspace-level rather than
 * inside the react package.
 */

/** Raw stylesheet text. Components render their own CSS via React 19's <style>. */
declare module '*.css?inline' {
  const css: string
  export default css
}

/** CSS Modules class map. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
