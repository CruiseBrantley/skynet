require('dotenv').config()
const { queryOllama } = require('../util/ollama')
const logger = require('../logger')

async function testGemini () {
  logger.info('Testing Gemini fallback...')
  try {
    const result = await queryOllama('/api/chat', {
      messages: [{ role: 'user', content: 'Say HELLO if you receive this.' }]
    }, 1) // Level 1 is Gemini
    logger.info('Gemini Result: ' + JSON.stringify(result))
  } catch (e) {
    logger.error('Gemini Test Failed: ' + e.message)
  }
}

testGemini()
