import { useTranslation } from '@/i18n/react-i18next-compat'

/** The slider uses model metadata; the numeric field remains available for
 * explicit context extension experiments beyond the model's declared window. */
export function ModelContextSlider({ value, max, min, disabled, onChange }: {
  value: number; max?: number | null; min: number; disabled?: boolean; onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  if (!Number.isSafeInteger(max) || max! < min) return <span className="min-w-0 break-words text-xs text-muted-foreground">{t('endpoints:localEngine.modelContextUnknown')}</span>
  return <div className="min-w-0">
    <input type="range" aria-label={t('endpoints:localEngine.contextSlider')}
      min={min} max={max!} step={1} disabled={disabled}
      value={Math.max(min, Math.min(max!, Number.isFinite(value) ? value : min))}
      onChange={event => onChange(Number(event.target.value))} className="block w-full min-w-0 accent-primary" />
    <p className="mt-1 break-words text-xs text-muted-foreground">{t('endpoints:localEngine.modelContextMax', { tokens: max!.toLocaleString() })}
      {value > max! && <> · {t('endpoints:localEngine.contextExtended')}</>}
    </p>
  </div>
}
