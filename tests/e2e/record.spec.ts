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
    JSON.stringify({ countdownSeconds: 3, whisperEnabled: false, clickRipples: false, sharePort: 0 })
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
    JSON.stringify({ countdownSeconds: 0, whisperEnabled: false, clickRipples: false, convertToMp4: false, sharePort: 0 })
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
    env: { ...process.env, LOOMLOCAL_E2E: '1', LOOMLOCAL_E2E_FAKE_MAC_PERMS: '1', LOOMLOCAL_DATA_DIR: data }
  })
  try {
    const main = await app.firstWindow()
    await expect(main.getByText('Falta un permiso de macOS para grabar la pantalla')).toBeVisible({ timeout: 15_000 })
    await expect(main.locator('.banner.steps')).toContainText('Electron')
    await expect(main.getByRole('button', { name: 'Reiniciar LoomLocal' })).toBeVisible()
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
