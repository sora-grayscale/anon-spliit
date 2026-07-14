/**
 * @jest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react'
import { ShareUrlButton } from './share-url-button'

const KEYED_URL = 'https://host/groups/g#SECRETKEY'

function setNavigatorShare(value: unknown) {
  Object.defineProperty(navigator, 'share', {
    value,
    configurable: true,
    writable: true,
  })
}

function setNavigatorCanShare(value: unknown) {
  Object.defineProperty(navigator, 'canShare', {
    value,
    configurable: true,
    writable: true,
  })
}

// Flattens a console-spy argument to a comparable string, regardless of
// whether it was logged as a string, an Error, or a plain object.
function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.message} ${arg.stack ?? ''}`
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

afterEach(() => {
  // jsdom has neither `share` nor `canShare` by default; restore that
  // absence so a mutation from one case never leaks into the next.
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
  jest.restoreAllMocks()
})

describe('ShareUrlButton', () => {
  it('stays usable when `share` exists but `canShare` does not (compat regression)', () => {
    const shareMock = jest.fn(() => Promise.resolve())
    setNavigatorShare(shareMock)
    // `canShare` is intentionally left unset, as in WebViews that shipped
    // `share` years before `canShare`.

    let utils!: ReturnType<typeof render>
    expect(() => {
      utils = render(<ShareUrlButton url={KEYED_URL} text="t" />)
    }).not.toThrow()

    const button = utils.queryByRole('button')
    expect(button).not.toBeNull()

    // "Usable" means the click actually invokes the Web Share API, not just
    // that a button renders.
    fireEvent.click(button as HTMLElement)
    expect(shareMock).toHaveBeenCalledTimes(1)
    expect(shareMock).toHaveBeenCalledWith({ url: KEYED_URL, text: 't' })
  })

  it('never logs the url/text (key material), even when the share sheet is dismissed', async () => {
    const secretUrl = 'https://host/groups/g#top-secret-encryption-key'
    const secretText = 'Join my very secret group on Spliit'

    setNavigatorShare(
      jest
        .fn()
        .mockImplementation(() => Promise.reject(new Error('share cancelled'))),
    )
    setNavigatorCanShare(jest.fn().mockReturnValue(true))

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const { getByRole } = render(
      <ShareUrlButton url={secretUrl} text={secretText} />,
    )
    fireEvent.click(getByRole('button'))

    // Flush the microtask queue so the rejected `.catch()` handler runs.
    await new Promise((resolve) => setTimeout(resolve, 0))

    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          const serialized = serializeArg(arg)
          expect(serialized).not.toContain(secretUrl)
          expect(serialized).not.toContain(secretText)
        }
      }
    }
  })

  it('renders nothing when the Web Share API is unsupported', () => {
    // Both `share` and `canShare` are left unset (jsdom default).
    const { queryByRole, container } = render(
      <ShareUrlButton url={KEYED_URL} text="t" />,
    )

    expect(queryByRole('button')).toBeNull()
    expect(container.firstChild).toBeNull()
  })
})
