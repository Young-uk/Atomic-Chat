import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { route } from '@/constants/routes'
import { ServerModelPicker } from '@/containers/server/ServerModelPicker'
import { DstarControlPanel } from '@/containers/server/DstarControlPanel'
import { ServerPage } from '@/containers/server/ServerPageParts'
import { useTranslation } from '@/i18n/react-i18next-compat'

/** Server → Engine & model: what the server loads and serves. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.api.model as any)({
  component: ServerModelPage,
})

export function ServerModelPage() {
  const { t } = useTranslation()
  const [hasDstar, setHasDstar] = useState(false)

  return (
    <ServerPage title={t('api:model.title')}>
      <DstarControlPanel onAvailabilityChange={setHasDstar} />
      <ServerModelPicker hideEmpty={hasDstar} />
    </ServerPage>
  )
}
