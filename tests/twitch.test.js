const { getSubscriptions, twitchSubscribe, testServer } = require('../server/server')
const oauth = require('../server/oauth')
const getURL = require('../server/ngrok')

const server = testServer()
const OAuthToken = oauth()
const url = getURL()

test('Twitch Subscribe', async () => {
  console.log
  const twitchSubscription = await twitchSubscribe(process.env.SIRI4N_ID, url, await OAuthToken)
  console.log('Subscribe response:', twitchSubscription)
  expect(twitchSubscription.status).toBe(200)
})

test('Get All Twitch Subscriptions', async () => {
  const subscriptions = await getSubscriptions(await OAuthToken)
  console.log(subscriptions)
  expect(subscriptions?.total).not.toBe(undefined)
})

test.todo('Delete Twitch Subscription')

test.todo('Delete All Subscriptions')

test.todo('Subscribe All')
