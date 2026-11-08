import { isPersonalBuild } from '@/lib/personal-build'
import { CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useTranslation } from '@/i18n/react-i18next-compat'

/** Personal-build opt-in; runtime support is checked for each new request. */
export default function CompletionReviewSetting() {
  const { t } = useTranslation()
  const enabled = useGeneralSetting((state) => state.completionReviewEnabled)
  const setEnabled = useGeneralSetting((state) => state.setCompletionReviewEnabled)
  if (!isPersonalBuild()) return null

  const title = t('settings:chatBehavior.completionReview')
  return (
    <CardItem
      title={title}
      description={
        <span id="atomic-completion-review-description">
          {t('settings:chatBehavior.completionReviewDesc')}
        </span>
      }
      actions={
        <Switch
          aria-label={title}
          aria-describedby="atomic-completion-review-description"
          checked={enabled === true}
          onCheckedChange={setEnabled}
        />
      }
    />
  )
}
