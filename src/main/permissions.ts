import { shell, systemPreferences } from 'electron'
import type { PermissionStatus } from '../shared/types'

export function permissionStatus(): PermissionStatus {
  if (process.platform !== 'darwin') {
    return { platform: process.platform, screen: 'granted', camera: 'granted', microphone: 'granted', accessibility: null }
  }
  return {
    platform: process.platform,
    screen: systemPreferences.getMediaAccessStatus('screen'),
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  }
}

export async function requestPermission(kind: 'camera' | 'microphone'): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  return systemPreferences.askForMediaAccess(kind)
}

const PANES: Record<string, string> = {
  screen: 'Privacy_ScreenCapture',
  camera: 'Privacy_Camera',
  microphone: 'Privacy_Microphone',
  accessibility: 'Privacy_Accessibility'
}

export async function openPermissionSettings(kind: string): Promise<void> {
  if (process.platform !== 'darwin') return
  if (kind === 'accessibility') {
    // Also triggers the system prompt that adds the app to the list.
    systemPreferences.isTrustedAccessibilityClient(true)
  }
  const pane = PANES[kind]
  if (pane) await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
}
