const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')
const axios = require('axios')
const logger = require('../logger')

// Locate ffmpeg binary (Homebrew or PATH)
function getFfmpegPath () {
  if (fs.existsSync('/opt/homebrew/bin/ffmpeg')) return '/opt/homebrew/bin/ffmpeg'
  if (fs.existsSync('/usr/local/bin/ffmpeg')) return '/usr/local/bin/ffmpeg'
  return 'ffmpeg'
}

/**
 * Extract up to maxFrames keyframes from a video/GIF URL or file using ffmpeg.
 * Returns an array of base64-encoded PNG strings.
 * @param {string} mediaUrl - URL of the video or GIF
 * @param {number} maxFrames - Maximum number of frames to extract (default: 6)
 * @returns {Promise<string[]>} Array of base64 PNG strings
 */
async function extractKeyframes (mediaUrl, maxFrames = 6) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skynet_frames_'))
  const inputPath = path.join(tempDir, 'input_media')
  const outputPattern = path.join(tempDir, 'frame_%03d.png')

  try {
    logger.info(`videoFrameExtractor: Downloading media for frame extraction: ${mediaUrl}`)
    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 30000 })
    fs.writeFileSync(inputPath, Buffer.from(response.data))

    const ffmpegBin = getFfmpegPath()

    // Extract frames at 1 frame per second, capped to maxFrames
    const ffmpegArgs = [
      '-y',
      '-i', inputPath,
      '-vf', 'fps=1',
      '-vframes', String(maxFrames),
      outputPattern
    ]

    await new Promise((resolve, reject) => {
      execFile(ffmpegBin, ffmpegArgs, { timeout: 30000 }, (error) => {
        if (error) {
          logger.warn(`videoFrameExtractor: ffmpeg error: ${error.message}`)
          return reject(error)
        }
        resolve()
      })
    })

    // Read generated frame files
    const files = fs.readdirSync(tempDir)
      .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()

    const base64Frames = []
    for (const file of files.slice(0, maxFrames)) {
      const frameBuffer = fs.readFileSync(path.join(tempDir, file))
      base64Frames.push(frameBuffer.toString('base64'))
    }

    logger.info(`videoFrameExtractor: Successfully extracted ${base64Frames.length} frames using ffmpeg.`)
    return base64Frames
  } catch (err) {
    logger.error(`videoFrameExtractor: Failed to extract keyframes: ${err.message}`)
    return []
  } finally {
    // Cleanup temporary directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch (cleanupErr) {
      logger.warn(`videoFrameExtractor: Cleanup error: ${cleanupErr.message}`)
    }
  }
}

/**
 * Check if an attachment or URL is a video or animated GIF.
 */
function isVideoOrGif (contentType = '', filename = '', url = '') {
  const cType = (contentType || '').toLowerCase()
  const fName = (filename || url || '').toLowerCase()
  const isVideoType = cType.startsWith('video/') || cType === 'image/gif'
  const videoExts = /\.(mp4|webm|mov|avi|mkv|gif)(\?.*)?$/i
  return isVideoType || videoExts.test(fName)
}

module.exports = {
  extractKeyframes,
  isVideoOrGif
}
