import { describe, expect, it } from 'vitest'
import { anchorBottomLeft, bubbleSize, clampBubbleWidth } from '../../src/shared/bubble'

const screen = { width: 1440, height: 900 }

describe('bubble geometry', () => {
  it('keeps circles square and rectangles vertical 9:16', () => {
    expect(bubbleSize(240, 'circle', screen)).toEqual({ width: 240, height: 240 })
    expect(bubbleSize(270, 'rect', screen)).toEqual({ width: 270, height: 480 })
  })

  it('clamps to a minimum, 60% of the screen width and 85% of its height', () => {
    expect(clampBubbleWidth(10, 'circle', screen)).toBe(120)
    expect(clampBubbleWidth(5000, 'circle', screen)).toBe(765) // 0.85 * 900
    expect(clampBubbleWidth(5000, 'rect', screen)).toBe(430) // 0.85 * 900 / (16/9)
    expect(clampBubbleWidth(5000, 'circle', { width: 1000, height: 2000 })).toBe(600)
    expect(clampBubbleWidth(Number.NaN, 'circle', screen)).toBe(120)
  })

  it('anchors the bottom-left corner when resizing', () => {
    const next = anchorBottomLeft({ x: 32, y: 600, width: 240, height: 240 }, { width: 270, height: 480 })
    expect(next).toEqual({ x: 32, y: 360, width: 270, height: 480 })
    expect(next.y + next.height).toBe(840)
  })
})
