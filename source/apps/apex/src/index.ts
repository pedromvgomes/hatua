/**
 * The apex, hatua.dev, answers two callers from one origin.
 *
 * `go get hatua.dev/go` resolves a module by fetching its import path over
 * HTTPS and reading a `go-import` meta tag; the module is then cloned from
 * whatever repository that tag names. The import path is baked into every
 * `go.mod` that depends on the SDK and cannot be changed without breaking
 * them, so this Worker has to keep answering `/go` for as long as the module
 * exists.
 *
 * The tag names a generated mirror rather than the monorepo because Go locates
 * a module by subtracting the import path from the repository root: a module
 * called `hatua.dev/go` has to sit at the root of the repository it is fetched
 * from, and this one lives at source/sdk/go. See source/sdk/go/doc.go.
 *
 * Everything else that reaches the apex is a person, and belongs on the
 * marketing site.
 */

const MODULE_PATH = 'hatua.dev/go'
const MIRROR = 'https://github.com/pedromvgomes/hatua-go'

export interface Env {
  /** Origin that everything other than the module path is sent to. */
  MARKETING_ORIGIN: string
}

/**
 * Go asks for the module path with `?go-get=1`, but the tag is served whatever
 * the query says: a person following a link to hatua.dev/go gets a page rather
 * than a blank document, and `go get` gets the same bytes either way.
 *
 * `go-source` is what gives pkg.go.dev its "look up a symbol in the source"
 * links. Without it the documentation renders, but every identifier on it is
 * dead text.
 */
const goImportPage = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="go-import" content="${MODULE_PATH} git ${MIRROR}" />
    <meta
      name="go-source"
      content="${MODULE_PATH} ${MIRROR} ${MIRROR}/tree/main{/dir} ${MIRROR}/blob/main{/dir}/{file}#L{line}"
    />
    <title>${MODULE_PATH}</title>
  </head>
  <body>
    <p>The Hatua Go SDK.</p>
    <pre>go get ${MODULE_PATH}</pre>
    <p><a href="https://pkg.go.dev/${MODULE_PATH}">Documentation</a></p>
  </body>
</html>
`

/**
 * The module path owns `/go` and everything under it. Go resolves a subpackage
 * by asking for the longest path first and shortening until a tag comes back,
 * so `/go/expressions` is asked for before `/go` and has to be answered by the
 * same tag rather than redirected away.
 */
const isModulePath = (pathname: string) => pathname === '/go' || pathname.startsWith('/go/')

export const respond = (url: URL, env: Env): Response => {
  if (isModulePath(url.pathname)) {
    return new Response(goImportPage(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    })
  }

  // The path is assigned to a URL built from the marketing origin rather than
  // concatenated into one. A request for `//example.com` parsed as a relative
  // URL resolves to that host, which would make the apex an open redirect; the
  // pathname setter cannot change the host.
  const target = new URL(env.MARKETING_ORIGIN)
  target.pathname = url.pathname
  target.search = url.search
  return Response.redirect(target.toString(), 302)
}

export default {
  fetch: (request: Request, env: Env) => respond(new URL(request.url), env),
}
