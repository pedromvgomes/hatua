import { describe, expect, it } from 'vitest'
import { type Env, respond } from './index'

const env: Env = { MARKETING_ORIGIN: 'https://www.hatua.dev' }
const at = (path: string) => respond(new URL(`https://hatua.dev${path}`), env)

describe('the module path', () => {
  it('serves the go-import tag naming the mirror', async () => {
    const body = await at('/go?go-get=1').text()

    expect(body).toContain(
      '<meta name="go-import" content="hatua.dev/go git https://github.com/pedromvgomes/hatua-go" />',
    )
  })

  it('serves the tag without the go-get query, so a link opens a page', async () => {
    const response = at('/go')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toContain('go-import')
  })

  it('answers for a subpackage, which Go asks for before the module root', async () => {
    const body = await at('/go/expressions?go-get=1').text()

    expect(body).toContain('content="hatua.dev/go git')
  })

  it('carries go-source, without which pkg.go.dev renders identifiers as dead text', async () => {
    const body = await at('/go?go-get=1').text()

    expect(body).toContain('name="go-source"')
    expect(body).toContain('{/dir}/{file}#L{line}')
  })
})

describe('everything else', () => {
  it('redirects the root to the marketing origin', () => {
    const response = at('/')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://www.hatua.dev/')
  })

  it('keeps the path and query', () => {
    expect(at('/pricing?ref=x').headers.get('location')).toBe('https://www.hatua.dev/pricing?ref=x')
  })

  it('refuses to send a protocol-relative path to another host', () => {
    expect(at('//example.com/').headers.get('location')).toBe('https://www.hatua.dev//example.com/')
  })

  it('does not treat a path merely starting with go as the module', () => {
    expect(at('/golang').headers.get('location')).toBe('https://www.hatua.dev/golang')
  })
})
