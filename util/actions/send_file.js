const fs = require('fs')
const path = require('path')
const logger = require('../../logger')

module.exports = {
  name: 'send_file',
  description: 'Uploads and sends a local file, log dump, generated image, patch, or document attachment to a Discord channel.',
  schema: {
    file_path: {
      type: 'string',
      description: 'Local file path on the host to attach and send (e.g. "logs/bot.log", "data/export.json", "frontend/public/icon.png").'
    },
    content: {
      type: 'string',
      description: 'Optional accompanying message text.'
    },
    channel_id: {
      type: 'string',
      description: 'Optional Snowflake ID of the target channel (defaults to current channel).'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const rawPath = (params.file_path || params.path || '').trim()
    if (!rawPath) {
      return { success: false, error: 'Parameter "file_path" is required.' }
    }

    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath)
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `File not found on disk at path: ${resolvedPath}` }
    }

    try {
      const client = bot?.client || bot
      let targetChannel = channel

      if (params.channel_id && client?.channels) {
        targetChannel = client.channels.cache?.get(params.channel_id) ||
          (await client.channels.fetch(params.channel_id).catch(() => null)) ||
          channel
      }

      if (!targetChannel || typeof targetChannel.send !== 'function') {
        return { success: false, error: 'Target channel not accessible or lacks send capability.' }
      }

      const fileName = path.basename(resolvedPath)
      const content = params.content !== undefined ? String(params.content) : ''

      logger.info(`send_file: Uploading "${fileName}" to channel ${targetChannel.id}`)
      const sent = await targetChannel.send({
        content: content || undefined,
        files: [
          {
            attachment: resolvedPath,
            name: fileName
          }
        ]
      })

      return {
        success: true,
        messageId: sent?.id || null,
        channelId: targetChannel.id,
        fileName
      }
    } catch (err) {
      logger.error(`send_file failed: ${err.message}`)
      return { success: false, error: `Failed to upload file: ${err.message}` }
    }
  }
}
