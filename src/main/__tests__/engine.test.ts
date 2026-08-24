import { describe, it, expect } from 'vitest'
import { samePath } from '../services/engine'

describe('samePath', () => {
  it('matches identical paths', () => {
    expect(samePath('/media/a.mov', '/media/a.mov')).toBe(true)
  })

  it('normalises . and .. segments', () => {
    expect(samePath('/media/./a.mov', '/media/sub/../a.mov')).toBe(true)
  })

  it.runIf(process.platform !== 'linux')('ignores case where the filesystem does', () => {
    // Arena reports whatever case the file was added with; comparing raw
    // strings would silently fail to match and the swap would never happen.
    expect(samePath('/Media/A.MOV', '/media/a.mov')).toBe(true)
  })

  it('does not match different files', () => {
    expect(samePath('/media/a.mov', '/media/b.mov')).toBe(false)
  })
})
