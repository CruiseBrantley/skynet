const getURL = require('../server/ngrok')

test('Returns an address', async () => {
  const url = await getURL()
  console.log(url)
  expect(url).not.toBe(undefined)
})
