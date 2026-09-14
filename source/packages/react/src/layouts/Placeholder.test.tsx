import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Placeholder } from './Placeholder'

/**
 * The body a region renders while it is empty, which is one paragraph and the
 * region's own words.
 */
describe('Placeholder', () => {
  it('draws the text it is handed as a paragraph', () => {
    render(<Placeholder>The Steps of this workflow.</Placeholder>)
    expect(screen.getByText('The Steps of this workflow.').tagName).toBe('P')
  })

  it('is a body and nothing else, so the region around it keeps its own landmark', () => {
    // A shell of its own here would put a second landmark inside the region
    // that mounted it, and every empty region would answer to two names.
    const { container } = render(<Placeholder>The Steps of this workflow.</Placeholder>)
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelector('section, h1, h2, button')).toBeNull()
  })
})
