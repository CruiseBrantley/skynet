const logger = require('../../logger')

function safeWarn (msg) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(msg)
  }
}

/**
 * Creates an event-driven status controller for slash commands and chat turns.
 * Instead of ticking seconds via interval edits, updates Discord and chat interfaces
 * immediately when an action or status change occurs.
 */
function createStatusHeartbeat (target, initialStatus = 'Skynet is thinking...') {
  let currentBaseText = initialStatus.replace(/^\*+|\*+$/g, '').trim()
  let isActive = false

  const editFn = typeof target === 'function'
    ? target
    : async (payload) => {
      if (target && typeof target.editReply === 'function') {
        return await target.editReply(payload)
      }
    }

  const stop = () => {
    isActive = false
  }

  const start = async () => {
    isActive = true
    try {
      const formatted = currentBaseText.includes('\n') || currentBaseText.startsWith('•') || currentBaseText.startsWith('✓')
        ? currentBaseText
        : `*${currentBaseText}*`
      await editFn({ content: formatted, flags: [4096] })
    } catch (e) {
      safeWarn(`statusHeartbeat initial edit failed: ${e.message}`)
    }
  }

  const updateStatus = async (newText) => {
    currentBaseText = (newText || '').trim()
    if (!currentBaseText) return

    try {
      const formatted = currentBaseText.includes('\n') || currentBaseText.startsWith('•') || currentBaseText.startsWith('✓')
        ? currentBaseText
        : `*${currentBaseText.replace(/^\*+|\*+$/g, '')}*`
      await editFn({ content: formatted, flags: [4096] })
    } catch (e) {
      safeWarn(`statusHeartbeat updateStatus failed: ${e.message}`)
    }
  }

  return {
    start,
    updateStatus,
    stop,
    isActive: () => isActive
  }
}

module.exports = {
  createStatusHeartbeat
}
