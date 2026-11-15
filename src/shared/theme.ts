export const THEMES = ['system', 'light', 'dark', 'catppuccin-mocha'] as const

export type Theme = (typeof THEMES)[number]
export type ResolvedTheme = Exclude<Theme, 'system'>

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value)
}
