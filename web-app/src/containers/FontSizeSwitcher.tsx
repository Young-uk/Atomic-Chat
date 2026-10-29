import { FONT_SCALE_OPTIONS, useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'

export function FontSizeSwitcher() {
  const { fontScale, setFontScale } = useInterfaceSettings()
  const { t } = useTranslation()
  const label = t('settings:interface.fontScale')

  return (
    <div className="w-full min-w-0 space-y-2" data-testid="font-scale-control">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="range"
          min={75}
          max={200}
          step={5}
          value={fontScale}
          aria-label={label}
          aria-valuetext={`${fontScale}%`}
          onChange={(event) => setFontScale(Number(event.target.value))}
          className="min-w-20 flex-1 accent-primary"
        />
        <select
          aria-label={t('settings:interface.fontScaleSelect')}
          value={fontScale}
          onChange={(event) => setFontScale(Number(event.target.value))}
          className="rounded-md border border-input bg-background px-2 text-sm tabular-nums"
          style={{ height: 'auto', minHeight: '2em' }}
        >
          {FONT_SCALE_OPTIONS.map((scale) => (
            <option key={scale} value={scale}>{scale}%</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setFontScale(100)}>
          100%
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('settings:interface.fontScaleDefault')}</p>
    </div>
  )
}
