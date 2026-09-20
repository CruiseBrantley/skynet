const { convertMarkdownTables } = require('../discordFormatter')

function splitMessage (text, maxChunkLen = 1900) {
  if (!text) return []
  const sanitizedText = convertMarkdownTables(text)
  const chunks = []
  let currentChunk = ''
  let inCodeBlock = false
  let codeBlockLang = ''

  const pushCurrent = () => {
    if (currentChunk.trim().length > 0) {
      if (inCodeBlock && !currentChunk.trim().endsWith('```')) {
        currentChunk += '\n```'
      }
      chunks.push(currentChunk)
    }
    currentChunk = ''
  }

  const lines = sanitizedText.split('\n')
  for (const line of lines) {
    const isFence = line.startsWith('```')

    if (isFence) {
      inCodeBlock = !inCodeBlock
      codeBlockLang = inCodeBlock ? line.replace(/```/g, '').trim() : ''
    }

    const codeCloseOverhead = inCodeBlock ? 5 : 0
    const codeOpenPrefix = inCodeBlock ? '```' + codeBlockLang + '\n' : ''

    if (currentChunk.length + line.length + 1 + codeCloseOverhead > maxChunkLen && !isFence) {
      pushCurrent()
    }

    if (line.length + codeCloseOverhead > maxChunkLen && !isFence) {
      let remaining = line
      while (remaining.length > 0) {
        const available = maxChunkLen - currentChunk.length - (inCodeBlock ? 5 : 0)
        if (available <= 50) {
          pushCurrent()
          currentChunk = codeOpenPrefix
        }
        const sliceLen = maxChunkLen - currentChunk.length - (inCodeBlock ? 5 : 0)
        let breakIdx = -1
        if (remaining.length > sliceLen) {
          breakIdx = remaining.lastIndexOf(' ', sliceLen)
          if (breakIdx <= 0) breakIdx = sliceLen
        } else {
          breakIdx = remaining.length
        }

        const part = remaining.substring(0, breakIdx)
        remaining = remaining.substring(breakIdx).trimStart()
        currentChunk += part
        if (remaining.length > 0) {
          pushCurrent()
          currentChunk = codeOpenPrefix
        }
      }
      currentChunk += '\n'
    } else {
      if (!currentChunk && inCodeBlock && !isFence) {
        currentChunk = codeOpenPrefix
      }
      currentChunk += line + '\n'
    }
  }

  pushCurrent()

  // Strict invariant: verify no chunk exceeds maxChunkLen
  const verifiedChunks = []
  for (const chunk of chunks) {
    if (chunk.length <= maxChunkLen) {
      if (chunk.trim().length > 0) verifiedChunks.push(chunk)
    } else {
      for (let k = 0; k < chunk.length; k += maxChunkLen) {
        const slice = chunk.substring(k, k + maxChunkLen)
        if (slice.trim().length > 0) verifiedChunks.push(slice)
      }
    }
  }

  if (verifiedChunks.length === 0 && text.trim().length > 0) {
    verifiedChunks.push(text.substring(0, maxChunkLen))
  }

  return verifiedChunks
}

module.exports = { splitMessage }
