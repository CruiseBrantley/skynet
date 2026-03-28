const { getSubscriptions, twitchSubscribe } = require('../server/server')
const axios = require('axios')

jest.mock('axios')

test('Twitch Subscribe', async () => {
  axios.post.mockResolvedValueOnce({ status: 200 })
  const twitchSubscription = await twitchSubscribe('12345', 'http://localhost/test', 'mock_token')
  expect(twitchSubscription).toBe(200)
})

test('Get All Twitch Subscriptions', async () => {
  axios.get.mockResolvedValueOnce({ data: { total: 5, data: [] } })
  const subscriptions = await getSubscriptions('mock_token')
  expect(subscriptions.total).toBe(5)
})
