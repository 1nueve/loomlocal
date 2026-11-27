import { app, shell, systemPreferences } from 'electron'
import type { PermissionStatus } from '../shared/types'

const appName = (): string => (app.isPackaged ? 'LoomLocal' : 'Electron')

export function permissionStatus(): PermissionStatus {
  if (process.env.LOOMLOCAL_E2E_FAKE_MAC_PERMS) {
    // Test hook: render the macOS first-run state on any OS.
    return { platform: 'darwin', appName: appName(), screen: 'not-determined', camera: 'denied', microphone: 'granted', accessibility: false }
  }
  if (process.platform !== 'darwin') {
    return { platform: process.platform, appName: appName(), screen: 'granted', camera: 'granted', microphone: 'granted', accessibility: null }
  }
  return {
    platform: process.platform,
    appName: appName(),
    screen: systemPreferences.getMediaAccessStatus('screen'),
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  }
}

export async function requestPermission(kind: 'camera' | 'microphone'): Promise<boolean> {
  if (process.platform !== 'darwin' || process.env.LOOMLOCAL_E2E_FAKE_MAC_PERMS) return true
  return systemPreferences.askForMediaAccess(kind)
}

const PANES: Record<string, string> = {
  screen: 'Privacy_ScreenCapture',
  camera: 'Privacy_Camera',
  microphone: 'Privacy_Microphone',
  accessibility: 'Privacy_Accessibility'
}

export async function openPermissionSettings(kind: string): Promise<void> {
  if (process.platform !== 'darwin' || process.env.LOOMLOCAL_E2E_FAKE_MAC_PERMS) return
  if (kind === 'accessibility') {
    // Also triggers the system prompt that adds the app to the list.
    systemPreferences.isTrustedAccessibilityClient(true)
  }
  const pane = PANES[kind]
  if (pane) await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
}
