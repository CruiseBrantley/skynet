const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const logger = require('../../logger')

module.exports = {
  name: 'update_avatar',
  description: 'Owner-Only: Updates the Discord bot avatar / profile picture. Accepts a local file path (e.g. "frontend/public/icon.png", "frontend/public/icon.svg") or image URL.',
  ownerOnly: true,
  privateOnly: true,
  schema: {
    image_path: {
      type: 'string',
      description: 'Local file path to the image (e.g. "frontend/public/icon.png" or "frontend/public/icon.svg"). Defaults to frontend/public/icon.png if omitted.'
    },
    image_url: {
      type: 'string',
      description: 'Optional URL of an image to set as the avatar.'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    try {
      const client = bot?.client || bot
      if (!client || !client.user || typeof client.user.setAvatar !== 'function') {
        return { success: false, error: 'Discord client user instance not available to set avatar.' }
      }

      let sourcePath = (params.image_path || params.path || params.file_path || '').trim()
      const imageUrl = (params.image_url || params.url || '').trim()

      if (imageUrl) {
        logger.info(`update_avatar: Setting avatar from URL ${imageUrl}`)
        await client.user.setAvatar(imageUrl)
        return { success: true, message: `Successfully updated bot avatar from URL: ${imageUrl}` }
      }

      if (!sourcePath) {
        sourcePath = 'frontend/public/icon.png'
      }

      const resolvedPath = path.isAbsolute(sourcePath)
        ? sourcePath
        : path.join(process.cwd(), sourcePath)

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `Image file not found at path: ${resolvedPath}` }
      }

      let avatarTarget = resolvedPath

      // If SVG, convert to PNG using macOS sips or fallback
      if (resolvedPath.toLowerCase().endsWith('.svg')) {
        const tmpPngPath = path.join(process.cwd(), 'frontend/public/icon.png')
        try {
          execSync(`/usr/bin/sips -s format png "${resolvedPath}" --out "${tmpPngPath}"`, { timeout: 10000 })
          if (fs.existsSync(tmpPngPath)) {
            avatarTarget = tmpPngPath
          }
        } catch (convErr) {
          logger.warn(`update_avatar: sips SVG conversion error: ${convErr.message}`)
        }
      }

      logger.info(`update_avatar: Setting Discord avatar from ${avatarTarget}`)
      await client.user.setAvatar(avatarTarget)
      return { success: true, message: `Successfully updated Discord avatar to "${sourcePath}".` }
    } catch (err) {
      logger.error(`update_avatar failed: ${err.message}`)
      return { success: false, error: `Failed to update Discord avatar: ${err.message}` }
    }
  }
}
