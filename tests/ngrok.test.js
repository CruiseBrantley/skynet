const getURL = require('../server/ngrok')

test('Returns an address', async () => {
  const url = await getURL()
  expect(url).not.toBe(undefined)
})
