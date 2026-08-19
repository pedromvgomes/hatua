import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Testing Library only auto-registers its cleanup when vitest runs with
 * `globals: true`. It does not here, so without this every render accumulates
 * in the same document and the second test to query a role finds two.
 */
afterEach(cleanup)
