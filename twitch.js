const { ApiClient } = require('twitch');
const { StaticAuthProvider } = require('twitch-auth');
const clientId = '123abc';
const accessToken = 'def456';
const authProvider = new StaticAuthProvider(clientId, accessToken);
const apiClient = new ApiClient({ authProvider });
