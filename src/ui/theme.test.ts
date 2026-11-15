// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, fetchSharedTheme, loadTheme, useTheme } from './theme.js'

/** The server side of the sync: GET answers `shared`, PUT records its body. */
function stubSettingsApi(shared: unknown = null) {
  const puts: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ ok: true }))
      }
      return new Response(JSON.stringify({ theme: shared }))
    }),
  )
  return puts
}

beforeEach(() => {
  stubSettingsApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('loadTheme', () => {
  it('defaults to system — a fresh profile follows the OS', () => {
    expect(loadTheme()).toBe('system')
  })

  it.each(['light', 'dark', 'catppuccin-mocha'])('restores the saved %s theme', (theme) => {
    localStorage.setItem('diffo:ui:theme', theme)
    expect(loadTheme()).toBe(theme)
  })

  it('treats junk in storage as system, not as a crash', () => {
    localStorage.setItem('diffo:ui:theme', 'neon')
    expect(loadTheme()).toBe('system')
  })
})

describe('applyTheme', () => {
  it('system is the absence of the attribute — the media query stays in charge', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('fetchSharedTheme', () => {
  it('returns the server value, and null for junk or an unreachable server', async () => {
    stubSettingsApi('dark')
    expect(await fetchSharedTheme()).toBe('dark')
    stubSettingsApi('neon')
    expect(await fetchSharedTheme()).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('no server')
      }),
    )
    expect(await fetchSharedTheme()).toBeNull()
  })
})

describe('useTheme', () => {
  it('applies Mocha and saves it locally and across review ports', async () => {
    const puts = stubSettingsApi()
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('catppuccin-mocha'))
    expect(result.current[0]).toBe('catppuccin-mocha')
    expect(document.documentElement.getAttribute('data-theme')).toBe('catppuccin-mocha')
    expect(localStorage.getItem('diffo:ui:theme')).toBe('catppuccin-mocha')
    await waitFor(() => expect(puts).toEqual([{ theme: 'catppuccin-mocha' }]))
  })

  it('setting a theme applies it and persists it', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('light'))
    expect(result.current[0]).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('diffo:ui:theme')).toBe('light')
  })

  it('returning to system removes both the attribute and the key', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('dark'))
    act(() => result.current[1]('system'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem('diffo:ui:theme')).toBeNull()
  })

  it('adopts the server-shared choice over the local cache on mount', async () => {
    // Chosen on another repo's port — this origin has never seen it.
    stubSettingsApi('catppuccin-mocha')
    const { result } = renderHook(() => useTheme())
    await waitFor(() => expect(result.current[0]).toBe('catppuccin-mocha'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('catppuccin-mocha')
    expect(localStorage.getItem('diffo:ui:theme')).toBe('catppuccin-mocha')
  })

  it('a set writes through to the server, so every other origin follows', async () => {
    const puts = stubSettingsApi()
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('dark'))
    await waitFor(() => expect(puts).toEqual([{ theme: 'dark' }]))
  })

  it('keeps the local choice when the server has none', async () => {
    localStorage.setItem('diffo:ui:theme', 'light')
    stubSettingsApi(null)
    const { result } = renderHook(() => useTheme())
    // The mount fetch resolves to nothing — the state must not move.
    await act(async () => {})
    expect(result.current[0]).toBe('light')
  })
})
