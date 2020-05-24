const oauth = require('../server/oauth')

test('Returns an OAuth Token', async () => {
  const OAuthToken = await oauth()
  expect(OAuthToken).not.toBe(undefined)
})
