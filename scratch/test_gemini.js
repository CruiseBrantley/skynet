require('dotenv').config()
const { queryOllama } = require('../util/ollama')

async function testGemini () {
  console.log('Testing Gemini (Level 1)...')
  try {
    const result = await queryOllama('/api/chat', {
      messages: [{ role: 'user', content: 'Say hello!' }]
    }, 1)
    console.log('Gemini Response:', JSON.stringify(result, null, 2))
  } catch (err) {
    console.error('Gemini Failed:', err.message)
  }
}

testGemini()
