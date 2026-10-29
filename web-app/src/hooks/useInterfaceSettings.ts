import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { useTheme } from './useTheme'

export type FontSize = `${number}px`

export const FONT_SCALE_MIN = 75
export const FONT_SCALE_MAX = 200
export const FONT_SCALE_STEP = 5
export const FONT_SCALE_OPTIONS = Array.from({ length: 26 }, (_, i) => 75 + i * 5)

export function normalizeFontScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, Math.round(value / 5) * 5))
}

const fontSizeForScale = (scale: number): FontSize => `${Number((13 * scale / 100).toFixed(2))}px`

/** Keep the previous type scale as closely as the new five-percent steps allow. */
export function migrateFontScale(state: { fontSize?: unknown; fontScale?: unknown }, version: number): number {
  if (version >= 2) return normalizeFontScale(state.fontScale)
  return normalizeFontScale(parseFloat(migrateFontSize(state.fontSize, version)) / 13 * 100)
}

//* Single preset: neutral sidebar without the purple/brand accent (--primary from index.css)
const ACCENT_THUMB = '#737373'
export const ACCENT_COLORS = [
  {
    name: 'Primary',
    value: 'primary',
    thumb: ACCENT_THUMB,
    sidebar: { light: '#f5f5f5', dark: '#2c2c2c' },
  },
] as const

export type AccentColorValue = (typeof ACCENT_COLORS)[number]['value']
const DEFAULT_ACCENT_COLOR: AccentColorValue = 'primary'

const applyAccentColorToDOM = (colorValue: string, isDark: boolean) => {
  const color = ACCENT_COLORS.find((c) => c.value === colorValue)
  if (!color) return

  const root = document.documentElement
  const sidebarColor = isDark ? color.sidebar.dark : color.sidebar.light

  root.style.setProperty('--sidebar', sidebarColor)
}

interface InterfaceSettingsState {
  fontSize: FontSize
  fontScale: number
  setFontScale: (scale: number) => void
  accentColor: AccentColorValue
  setFontSize: (size: FontSize) => void
  setAccentColor: (color: AccentColorValue) => void
  resetInterface: () => Promise<void>
}

type InterfaceSettingsPersistedSlice = Omit<
  InterfaceSettingsState,
  'resetInterface' | 'setFontSize' | 'setFontScale' | 'setAccentColor'
>

export const fontSizeOptions = [
  { label: 'Small', value: '12px' as FontSize },
  { label: 'Medium', value: '13px' as FontSize },
  { label: 'Large', value: '16px' as FontSize },
  { label: 'Extra Large', value: '20px' as FontSize },
]

// Default interface settings
const defaultFontSize: FontSize = '13px'

/**
 * Version 1 of the stored settings made the default type a fifth smaller.
 * A size saved before it moves to the option that now carries its label;
 * `15px` was Medium before that.
 */
const VERSION_0_FONT_SIZES: Record<string, FontSize> = {
  '14px': '12px',
  '15px': '13px',
  '16px': '13px',
  '18px': '16px',
  '20px': '20px',
}

/** The stored font size, read under the current option scale. */
export function migrateFontSize(saved: unknown, version: number): FontSize {
  if (typeof saved !== 'string') return defaultFontSize
  if (version < 1) return VERSION_0_FONT_SIZES[saved] ?? defaultFontSize
  return fontSizeOptions.some((option) => option.value === saved)
    ? (saved as FontSize)
    : defaultFontSize
}

const createDefaultInterfaceValues = (): InterfaceSettingsPersistedSlice => {
  return {
    fontSize: defaultFontSize,
    fontScale: 100,
    accentColor: DEFAULT_ACCENT_COLOR,
  }
}

const interfaceStorage = createJSONStorage<InterfaceSettingsState>(() =>
  localStorage
)

export const useInterfaceSettings = create<InterfaceSettingsState>()(
  persist(
    (set) => {
      const defaultState = createDefaultInterfaceValues()
      return {
        ...defaultState,
        resetInterface: async () => {
          await useTheme.getState().setTheme('auto')
          const { isDark } = useTheme.getState()

          // Reset font size
          document.documentElement.style.setProperty(
            '--font-size-base',
            defaultFontSize
          )

          // Reset accent color preset
          applyAccentColorToDOM(DEFAULT_ACCENT_COLOR, isDark)

          // Update state
          set({
            fontSize: defaultFontSize,
            fontScale: 100,
            accentColor: DEFAULT_ACCENT_COLOR,
          })
        },

        setAccentColor: (color: AccentColorValue) => {
          const colorExists = ACCENT_COLORS.find((c) => c.value === color)
          if (!colorExists) return

          const { isDark } = useTheme.getState()
          applyAccentColorToDOM(color, isDark)
          set({ accentColor: color })
        },

        setFontScale: (value: number) => {
          const fontScale = normalizeFontScale(value)
          const fontSize = fontSizeForScale(fontScale)
          document.documentElement.style.setProperty('--font-size-base', fontSize)
          set({ fontScale, fontSize })
        },
        setFontSize: (size: FontSize) => {
          const fontScale = normalizeFontScale(parseFloat(size) / 13 * 100)
          const fontSize = fontSizeForScale(fontScale)
          // Update CSS variable
          document.documentElement.style.setProperty('--font-size-base', fontSize)
          // Update state
          set({ fontSize, fontScale })
        },
      }
    },
    {
      name: localStorageKey.settingInterface,
      storage: interfaceStorage,
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ??
          {}) as Partial<InterfaceSettingsPersistedSlice>
        const fontScale = migrateFontScale(state, version)
        return {
          ...state,
          fontScale,
          fontSize: fontSizeForScale(fontScale),
        } as InterfaceSettingsState
      },
      // Apply settings when hydrating from storage
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.fontScale = normalizeFontScale(state.fontScale)
          state.fontSize = fontSizeForScale(state.fontScale)

          // Migrate accent: if the saved preset no longer exists — apply the only one
          const colorExists = ACCENT_COLORS.some((c) => c.value === state.accentColor)
          if (!colorExists) {
            state.accentColor = DEFAULT_ACCENT_COLOR
          }

          // Apply font size from storage
          document.documentElement.style.setProperty(
            '--font-size-base',
            state.fontSize
          )

          const { isDark } = useTheme.getState()
          const accentColorValue = state.accentColor || DEFAULT_ACCENT_COLOR
          applyAccentColorToDOM(accentColorValue, isDark)
        }

        return state
      },
    }
  )
)

// Subscribe to theme changes to update accent color sidebar variant
let prevIsDark = useTheme.getState().isDark
useTheme.subscribe((state) => {
  if (state.isDark !== prevIsDark) {
    prevIsDark = state.isDark
    const { accentColor } = useInterfaceSettings.getState()
    applyAccentColorToDOM(accentColor, state.isDark)
  }
})
