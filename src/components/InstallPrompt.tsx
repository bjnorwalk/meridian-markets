import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as NavigatorWithStandalone).standalone === true
  )
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => isStandaloneMode())

  useEffect(() => {
    if (installed) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    const installedHandler = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    globalThis.addEventListener('beforeinstallprompt', handler)
    globalThis.addEventListener('appinstalled', installedHandler)

    return () => {
      globalThis.removeEventListener('beforeinstallprompt', handler)
      globalThis.removeEventListener('appinstalled', installedHandler)
    }
  }, [installed])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const result = await deferredPrompt.userChoice
    if (result.outcome === 'accepted') setInstalled(true)
    setDeferredPrompt(null)
  }

  if (installed || !deferredPrompt) return null

  return (
    <button className="install-prompt" onClick={handleInstall} type="button" title="Install app">
      <Download aria-hidden="true" size={15} />
    </button>
  )
}
