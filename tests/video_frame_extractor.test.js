const { isVideoOrGif, extractKeyframes } = require('../util/videoFrameExtractor')
const axios = require('axios')
const { execFile } = require('child_process')
const fs = require('fs')

jest.mock('axios')
jest.mock('child_process')
jest.mock('../logger')

describe('videoFrameExtractor', () => {
  describe('isVideoOrGif', () => {
    test('identifies video and gif content types and extensions', () => {
      expect(isVideoOrGif('image/gif', 'funny.gif')).toBe(true)
      expect(isVideoOrGif('video/mp4', 'clip.mp4')).toBe(true)
      expect(isVideoOrGif('', 'movie.webm')).toBe(true)
      expect(isVideoOrGif('image/png', 'photo.png')).toBe(false)
      expect(isVideoOrGif('text/plain', 'notes.txt')).toBe(false)
    })
  })

  describe('extractKeyframes', () => {
    test('returns empty array on error', async () => {
      axios.get.mockRejectedValueOnce(new Error('Network error'))
      const frames = await extractKeyframes('https://example.com/bad.mp4')
      expect(frames).toEqual([])
    })

    test('successfully extracts frames when ffmpeg succeeds', async () => {
      axios.get.mockResolvedValueOnce({ data: Buffer.from('dummy-video-content') })
      execFile.mockImplementation((bin, args, options, cb) => {
        // Find output directory from args
        const outPattern = args[args.length - 1]
        const outDir = require('path').dirname(outPattern)
        fs.writeFileSync(require('path').join(outDir, 'frame_001.png'), 'png-1')
        fs.writeFileSync(require('path').join(outDir, 'frame_002.png'), 'png-2')
        cb(null, 'stdout', '')
      })

      const frames = await extractKeyframes('https://example.com/test.mp4', 6)
      expect(frames.length).toBe(2)
      expect(Buffer.from(frames[0], 'base64').toString()).toBe('png-1')
      expect(Buffer.from(frames[1], 'base64').toString()).toBe('png-2')
    })
  })
})
