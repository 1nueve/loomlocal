import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Video } from '../../src/shared/types'

const shots = process.env.LOOMLOCAL_SHOTS

test('records the screen with mic, pause, marker and drawing, then shares it', async () => {
  const data = mkdtempSync(join(tmpdir(), 'loomlocal-e2e-'))
  writeFileSync(
    join(data, 'settings.json'),
    JSON.stringify({ countdownSeconds: 3, whisperEnabled: false, clickRipples: false, sharePort: 0, hideToolbarWhileRecording: false })
  )
  const app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox'],
    env: { ...process.env, LOOMLOCAL_E2E: '1', LOOMLOCAL_DATA_DIR: data }
  })
  try {
    const main = await app.firstWindow()
    await main.setViewportSize?.({ width: 1180, height: 800 })
    await expect(main.getByRole('heading', { name: '¿Qué quieres grabar?' })).toBeVisible()
    await expect(main.locator('.source').first()).toBeVisible({ timeout: 20_000 })
    // Fake devices from --use-fake-device-for-media-stream
    await expect(main.locator('select').nth(1).locator('option')).not.toHaveCount(1)
    if (shots) await main.screenshot({ path: join(shots, '1-panel.png') })

    await main.getByRole('button', { name: 'Empezar grabación' }).click()

    const findWindow = async (hash: string): Promise<Page> => {
      for (let i = 0; i < 100; i++) {
        const w = app.windows().find((p) => p.url().includes(`#${hash}`))
        if (w) return w
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error(`window ${hash} not found`)
    }
    const overlay = await findWindow('/overlay')
    await expect(overlay.locator('.countdown-num')).toBeVisible()
    if (shots) await overlay.screenshot({ path: join(shots, '2-countdown.png') })
    await overlay.locator('.countdown').click() // skip

    const toolbar = await findWindow('/toolbar')
    await expect(toolbar.locator('.rec-dot.recording')).toBeVisible({ timeout: 10_000 })
    await toolbar.waitForTimeout(1500)

    await toolbar.getByTitle('Pausar o reanudar').click()
    await expect(toolbar.locator('.rec-dot.paused')).toBeVisible()
    await toolbar.getByTitle('Pausar o reanudar').click()
    await expect(toolbar.locator('.rec-dot.recording')).toBeVisible()

    await toolbar.getByTitle('Agregar marcador').click()
    await expect(toolbar.locator('sup')).toHaveText('1')

    await toolbar.getByTitle('Dibujar').click()
    await expect(toolbar.getByTitle('Resaltador')).toBeVisible()
    await expect(overlay.locator('.overlay.drawing')).toBeVisible()
    const box = { x: 300, y: 300 }
    await overlay.mouse.move(box.x, box.y)
    await overlay.mouse.down()
    await overlay.mouse.move(box.x + 200, box.y + 80, { steps: 10 })
    await overlay.mouse.up()
    if (shots) await toolbar.screenshot({ path: join(shots, '3-toolbar.png') })
    await toolbar.getByTitle('Dibujar').click()
    await toolbar.waitForTimeout(1500)

    await toolbar.getByRole('button', { name: 'Terminar' }).click()

    await expect(main).toHaveURL(/#\/video\//, { timeout: 20_000 })
    const id = main.url().split('#/video/')[1]
    let video: Video | null = null
    await expect
      .poll(
        async () => {
          video = (await main.evaluate((vid) => window.api.getVideo(vid), id)) as Video | null
          return video ? `${video.status}:${video.converting ? 'conv' : 'done'}` : 'missing'
        },
        { timeout: 60_000 }
      )
      .toBe('ready:done')
    const v = video as unknown as Video
    expect(v.file.endsWith('.mp4')).toBe(true)
    expect(v.markers).toHaveLength(1)
    expect(v.durationMs).toBeGreaterThan(2000)
    expect(v.sizeBytes).toBeGreaterThan(10_000)
    expect(v.thumb).toBeTruthy()

    await expect(main.locator('video.player')).toBeVisible()
    await expect.poll(() => main.locator('video.player').evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 15_000 }).toBeGreaterThan(0)
    const duration = await main.locator('video.player').evaluate((el: HTMLVideoElement) => el.duration)
    expect(duration).toBeGreaterThan(2)
    if (shots) await main.screenshot({ path: join(shots, '4-video.png') })

    const share = (await main.evaluate(() => window.api.shareInfo())) as { localBase: string }
    const page = await fetch(`${share.localBase}/v/${v.shareToken}`)
    expect(page.status).toBe(200)
    const file = await fetch(`${share.localBase}/v/${v.shareToken}/video`, { headers: { Range: 'bytes=0-1023' } })
    expect(file.status).toBe(206)
    expect(file.headers.get('content-type')).toBe('video/mp4')

    await main.getByRole('button', { name: 'Biblioteca', exact: true }).click()
    await expect(main.locator('.video-card')).toHaveCount(1)
    if (shots) await main.screenshot({ path: join(shots, '5-library.png') })
  } finally {
    await app.close()
    rmSync(data, { recursive: true, force: true })
  }
})

test('captures the real screen through the display-media handler', async () => {
  const data = mkdtempSync(join(tmpdir(), 'loomlocal-e2e-real-'))
  writeFileSync(
    join(data, 'settings.json'),
    JSON.stringify({ countdownSeconds: 0, whisperEnabled: false, clickRipples: false, convertToMp4: false, sharePort: 0, hideToolbarWhileRecording: false })
  )
  const app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox'],
    env: { ...process.env, LOOMLOCAL_E2E: '1', LOOMLOCAL_E2E_REAL_SCREEN: '1', LOOMLOCAL_DATA_DIR: data }
  })
  try {
    const main = await app.firstWindow()
    await expect(main.locator('.source').first()).toBeVisible({ timeout: 20_000 })
    await main.locator('select').nth(1).selectOption('')
    await main.getByRole('button', { name: 'Empezar grabación' }).click()
    let toolbar: Page | undefined
    await expect.poll(() => (toolbar = app.windows().find((p) => p.url().includes('#/toolbar'))) !== undefined, { timeout: 15_000 }).toBe(true)
    await expect(toolbar!.locator('.rec-dot.recording')).toBeVisible({ timeout: 10_000 })
    await toolbar!.waitForTimeout(2500)
    await toolbar!.getByRole('button', { name: 'Terminar' }).click()
    await expect(main).toHaveURL(/#\/video\//, { timeout: 20_000 })
    const id = main.url().split('#/video/')[1]
    await expect.poll(async () => ((await main.evaluate((vid) => window.api.getVideo(vid), id)) as Video).status, { timeout: 30_000 }).toBe('ready')
    const v = (await main.evaluate((vid) => window.api.getVideo(vid), id)) as Video
    expect(v.file.endsWith('.webm')).toBe(true)
    expect(v.sizeBytes).toBeGreaterThan(1000)
    if (shots) {
      const { execFileSync } = await import('node:child_process')
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', join(data, 'videos', v.file), '-frames:v', '1', join(shots, '6-real-frame.png')])
    }
  } finally {
    await app.close()
    rmSync(data, { recursive: true, force: true })
  }
})

test('guides macOS first run: screen permission steps without technical errors', async () => {
  const data = mkdtempSync(join(tmpdir(), 'loomlocal-e2e-perms-'))
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ sharePort: 0 }))
  const app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox'],
    env: { ...process.env, LOOMLOCAL_E2E: '1', LOOMLOCAL_E2E_FAKE_MAC_PERMS: '1', TERM_PROGRAM: 'iTerm.app', LOOMLOCAL_DATA_DIR: data }
  })
  try {
    const main = await app.firstWindow()
    await expect(main.getByText('Falta un permiso de macOS para grabar la pantalla')).toBeVisible({ timeout: 15_000 })
    await expect(main.locator('.banner.steps')).toContainText('Activa la casilla de iTerm')
    await expect(main.locator('.banner.steps')).toContainText('Cierra iTerm por completo')
    // Relaunching Electron does not restart the terminal that owns the permission.
    await expect(main.getByRole('button', { name: 'Reiniciar LoomLocal' })).toHaveCount(0)
    await expect(main.getByText('macOS bloqueó la cámara')).toBeVisible()
    await main.waitForTimeout(1500)
    await expect(main.getByText('No pude listar pantallas')).toHaveCount(0)
    await expect(main.getByText('No encontré pantallas')).toHaveCount(0)
    if (shots) await main.screenshot({ path: join(shots, '7-mac-perms.png') })
  } finally {
    await app.close()
    rmSync(data, { recursive: true, force: true })
  }
})

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>

async function launch(settings: Record<string, unknown>): Promise<{ app: ElectronApp; main: Page; data: string }> {
  const data = mkdtempSync(join(tmpdir(), 'loomlocal-e2e-x-'))
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ whisperEnabled: false, clickRipples: false, sharePort: 0, ...settings }))
  const app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox'],
    env: { ...process.env, LOOMLOCAL_E2E: '1', LOOMLOCAL_DATA_DIR: data }
  })
  const main = await app.firstWindow()
  await expect(main.locator('.source').first()).toBeVisible({ timeout: 20_000 })
  return { app, main, data }
}

async function windowFor(app: ElectronApp, hash: string): Promise<Page> {
  let found: Page | undefined
  await expect.poll(() => (found = app.windows().find((p) => p.url().includes(`#${hash}`))) !== undefined, { timeout: 15_000 }).toBe(true)
  return found!
}

const visible = (app: ElectronApp, hash: string) =>
  app.evaluate(({ BrowserWindow }, h) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(`#${h}`))
    return w ? w.isVisible() : null
  }, hash)

const bounds = (app: ElectronApp, hash: string) =>
  app.evaluate(({ BrowserWindow }, h) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(`#${h}`))
    return w ? w.getBounds() : null
  }, hash)

test('hides the toolbar while recording and toggles it from the tray controls', async () => {
  const { app, main, data } = await launch({ countdownSeconds: 3, hideToolbarWhileRecording: true, convertToMp4: false })
  try {
    await main.getByRole('button', { name: 'Empezar grabación' }).click()
    const overlay = await windowFor(app, '/overlay')
    await windowFor(app, '/toolbar')
    await expect(overlay.locator('.countdown-num')).toBeVisible()
    await expect.poll(() => visible(app, '/toolbar')).toBe(true) // visible during the countdown
    await overlay.locator('.countdown').click()
    await expect.poll(() => visible(app, '/toolbar')).toBe(false) // hidden once recording
    await app.evaluate(() => (globalThis as any).__loomlocalTest.recording.toggleToolbar())
    await expect.poll(() => visible(app, '/toolbar')).toBe(true)
    await app.evaluate(() => (globalThis as any).__loomlocalTest.recording.toggleToolbar())
    await expect.poll(() => visible(app, '/toolbar')).toBe(false)
    await main.waitForTimeout(1200)
    await app.evaluate(() => (globalThis as any).__loomlocalTest.recording.command({ type: 'finish' }))
    await expect(main).toHaveURL(/#\/video\//, { timeout: 20_000 })
  } finally {
    await app.close()
    rmSync(data, { recursive: true, force: true })
  }
})

test('draws thin and thick strokes with different widths', async () => {
  const { app, main, data } = await launch({ countdownSeconds: 0, hideToolbarWhileRecording: false, drawFade: false, convertToMp4: false })
  try {
    await main.getByRole('button', { name: 'Empezar grabación' }).click()
    const toolbar = await windowFor(app, '/toolbar')
    const overlay = await windowFor(app, '/overlay')
    await expect(toolbar.locator('.rec-dot.recording')).toBeVisible({ timeout: 10_000 })
    await toolbar.getByTitle('Dibujar').click()
    await expect(overlay.locator('.overlay.drawing')).toBeVisible()

    const stroke = async (y: number) => {
      await overlay.mouse.move(200, y)
      await overlay.mouse.down()
      await overlay.mouse.move(500, y, { steps: 12 })
      await overlay.mouse.up()
    }
    await toolbar.getByTitle('Grosor fino').click()
    await stroke(200)
    await toolbar.getByTitle('Grosor grueso').click()
    await stroke(400)
    // Count painted pixels in a vertical slice crossing each line.
    const thickness = await overlay.evaluate(() => {
      const c = document.querySelector('canvas')!
      const ctx = c.getContext('2d')!
      const dpr = window.devicePixelRatio
      const column = (y0: number, y1: number) => {
        const img = ctx.getImageData(Math.round(350 * dpr), Math.round(y0 * dpr), 1, Math.round((y1 - y0) * dpr)).data
        let n = 0
        for (let i = 3; i < img.length; i += 4) if (img[i] > 128) n++
        return n / dpr
      }
      return { thin: column(150, 250), thick: column(350, 450) }
    })
    expect(thickness.thin).toBeGreaterThan(1)
    expect(thickness.thick).toBeGreaterThan(thickness.thin * 2.5)
    await toolbar.getByTitle('Dibujar').click()
    await app.evaluate(() => (globalThis as any).__loomlocalTest.recording.command({ type: 'cancel' }))
  } finally {
    await app.close()
    rmSync(data, { recursive: true, force: true })
  }
})

test('camera bubble: voice ring reacts to the mic, vertical 9:16 shape and free resize', async () => {
  const { app, main, data } = await launch({})
  try {
    const cameraSelect = main.locator('select').first()
    await expect(cameraSelect.locator('option')).not.toHaveCount(1)
    const cam = await cameraSelect.locator('option').nth(1).getAttribute('value')
    await cameraSelect.selectOption(cam!)
    const bubble = await windowFor(app, '/bubble')
    // The fake microphone emits a periodic beep: the ring must light up.
    await expect
      .poll(() => bubble.locator('.bubble-ring').evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 10_000 })
      .toBeGreaterThan(0.3)

    await bubble.getByTitle('Rectángulo vertical (9:16)').click({ force: true })
    await expect.poll(async () => {
      const b = await bounds(app, '/bubble')
      return b ? Math.round((b.height / b.width) * 100) : 0
    }).toBe(178)
    const before = (await bounds(app, '/bubble'))!

    const handle = bubble.locator('.bubble-resize')
    const box = (await handle.boundingBox())!
    await bubble.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await bubble.mouse.down()
    await bubble.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 })
    await bubble.mouse.up()
    await expect.poll(async () => (await bounds(app, '/bubble'))!.width).toBeGreaterThan(before.width + 40)
    const after = (await bounds(app, '/bubble'))!
    expect(Math.round((after.height / after.width) * 100)).toBe(178)
    expect(after.y + after.height).toBe(before.y + before.height) // bottom edge anchored

    // Reopening the bubble keeps the custom size.
    await cameraSelect.selectOption('')
    await expect.poll(() => visible(app, '/bubble')).toBe(null)
    await cameraSelect.selectOption(cam!)
    await windowFor(app, '/bubble')
    await expect.poll(async () => (await bounds(app, '/bubble'))?.width ?? 0, { timeout: 10_000 }).toBe(after.width)
    if (shots) await bubble.screenshot({ path: join(shots, '8-bubble.png') }).catch(() => undefined)
  } finally {
    await app.close()
    rmSync(data, { recursive: true, force: true })
  }
})
