const getURL = require('../server/ngrok')
const ngrok = require('ngrok')

test('Returns an address', async () => {
  const url = await getURL()
  expect(url).not.toBe(undefined)
  await ngrok.disconnect()
  ngrok.kill()
})
