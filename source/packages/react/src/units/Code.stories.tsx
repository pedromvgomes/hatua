import type { Meta, StoryObj } from '@storybook/react-vite'
import { Code, type CodeToken } from './Code'

/**
 * The palette, and nothing else.
 *
 * Tokens are written out by hand here rather than produced, and that is the
 * unit's contract showing through: it is handed tokens and decides nothing about
 * what a token IS. The producers live a tier up, where they may read the document
 * and the parser — `layouts/highlight.ts` — and reaching for them from here is
 * what the tier lint refuses.
 *
 * So this is the palette review: every kind at once, in both colour modes,
 * because a highlighter's whole job is that the kinds are told apart at a glance
 * and a palette that works on one background and muddies on the other is one
 * nobody notices until a Host pins the mode they do not develop in.
 *
 * The two surfaces drawn from real sources are `Layouts/TextMode` and
 * `Layouts/RunStep`.
 */

const line = (...tokens: CodeToken[]): CodeToken[] => [...tokens, { text: '\n', kind: 'plain' }]

const pair = (key: string, value: string, kind: CodeToken['kind']): CodeToken[] =>
  line({ text: key, kind: 'key' }, { text: ': ', kind: 'punctuation' }, { text: value, kind })

const meta = {
  title: 'Units/Code',
  component: Code,
  decorators: [
    (Story) => (
      <div
        style={{
          inlineSize: 520,
          padding: 12,
          background: 'var(--hatua-surface-sunken)',
          borderRadius: 'var(--hatua-radius-sm)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Code>

export default meta
type Story = StoryObj<typeof meta>

/** Every kind at once, which is what a palette is judged on. */
export const EveryKind: Story = {
  args: {
    tokens: [
      ...line({ text: '# a comment, and the only italic here', kind: 'comment' }),
      ...pair('slug', 'wf_morning', 'plain'),
      ...pair('name', '"Morning inbox triage"', 'string'),
      ...pair('version', '4', 'number'),
      ...pair('published', 'true', 'number'),
      ...pair('archived', 'null', 'number'),
      ...line(
        { text: 'to', kind: 'key' },
        { text: ': ', kind: 'punctuation' },
        { text: '"', kind: 'string' },
        { text: '{{ var.digest_to }}', kind: 'reference' },
        { text: '"', kind: 'string' },
      ),
    ],
  },
}

/**
 * A **Reference** inside a longer string.
 *
 * The one span no off-the-shelf grammar knows about — to a YAML grammar the
 * whole line is one flat string — and the reason it carries the accent: it is
 * what names something live in the document.
 */
export const ReferencesInAString: Story = {
  args: {
    tokens: line(
      { text: 'subject', kind: 'key' },
      { text: ': ', kind: 'punctuation' },
      { text: '"Re: ', kind: 'string' },
      { text: '{{ steps.s1.subject }}', kind: 'reference' },
      { text: ' — ', kind: 'string' },
      { text: '{{ run.id }}', kind: 'reference' },
      { text: '"', kind: 'string' },
    ),
  },
}

/**
 * A payload's shape. The same five colours as the document above, which is the
 * whole reason this is one component rather than two blocks of markup.
 */
export const Payload: Story = {
  args: {
    tokens: [
      ...line({ text: '{', kind: 'punctuation' }),
      ...line(
        { text: '  ', kind: 'plain' },
        { text: '"folder"', kind: 'key' },
        { text: ': ', kind: 'punctuation' },
        { text: '"INBOX"', kind: 'string' },
        { text: ',', kind: 'punctuation' },
      ),
      ...line(
        { text: '  ', kind: 'plain' },
        { text: '"count"', kind: 'key' },
        { text: ': ', kind: 'punctuation' },
        { text: '24', kind: 'number' },
      ),
      { text: '}', kind: 'punctuation' },
    ],
  },
}

/** Nothing coloured at all, which a plain scalar document is. */
export const AllPlain: Story = {
  args: { tokens: [{ text: 'nothing here is a key, a string or a number\n', kind: 'plain' }] },
}
