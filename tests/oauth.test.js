const oauth = require('../server/oauth');
const axios = require('axios');

jest.mock('axios');

test('Returns an OAuth Token', async () => {
  axios.post.mockResolvedValueOnce({ data: { access_token: 'mock_token' } });
  const OAuthToken = await oauth();
  expect(OAuthToken).toBe('mock_token');
});
