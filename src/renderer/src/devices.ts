export interface DeviceOption {
  deviceId: string
  label: string
}

export interface DeviceLists {
  cameras: DeviceOption[]
  mics: DeviceOption[]
  /** Linux: PulseAudio/PipeWire monitor inputs that carry system audio. */
  monitors: DeviceOption[]
}

/**
 * Lists cameras and microphones. Device labels stay empty until the page has
 * been granted access once, so a short getUserMedia probe runs first when
 * needed, then enumeration is repeated.
 */
export async function listDevices(): Promise<DeviceLists> {
  let devices = await navigator.mediaDevices.enumerateDevices()
  if (!devices.every((d) => d.label)) {
    for (const constraints of [{ audio: true, video: true }, { audio: true }, { video: true }]) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia(constraints)
        probe.getTracks().forEach((t) => t.stop())
        break
      } catch {
        // try a narrower probe (e.g. no camera connected)
      }
    }
    devices = await navigator.mediaDevices.enumerateDevices()
  }
  const toOption = (d: MediaDeviceInfo, i: number, kind: string): DeviceOption => ({
    deviceId: d.deviceId,
    label: d.label || `${kind} ${i + 1}`
  })
  const cams = devices.filter((d) => d.kind === 'videoinput' && d.deviceId)
  const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications')
  const isMonitor = (d: MediaDeviceInfo) => /monitor/i.test(d.label)
  return {
    cameras: cams.map((d, i) => toOption(d, i, 'Cámara')),
    mics: inputs.filter((d) => !isMonitor(d)).map((d, i) => toOption(d, i, 'Micrófono')),
    monitors: inputs.filter(isMonitor).map((d, i) => toOption(d, i, 'Audio del sistema'))
  }
}
