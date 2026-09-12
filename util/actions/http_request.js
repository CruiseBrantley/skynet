const axios = require('axios')
const logger = require('../../logger')

module.exports = {
  name: 'http_request',
  description: 'Executes an arbitrary HTTP request (REST API queries, webhooks, JSON endpoints, or external services). Returns status code, headers, and parsed response data.',
  schema: {
    url: {
      type: 'string',
      description: 'The full HTTP or HTTPS URL to request.'
    },
    method: {
      type: 'string',
      description: 'HTTP method: GET, POST, PUT, PATCH, DELETE, or HEAD (default: GET).'
    },
    headers: {
      type: 'object',
      description: 'Optional key-value object of HTTP headers to include in the request.'
    },
    body: {
      type: 'string',
      description: 'Optional request body data (JSON object or string payload).'
    },
    timeout_ms: {
      type: 'number',
      description: 'Request timeout in milliseconds (default: 15000, max: 60000).'
    },
    response_type: {
      type: 'string',
      description: 'Response type format: "json" or "text" (default: "json").'
    }
  },
  execute: async (bot, channel, params = {}, context = {}) => {
    const rawUrl = params.url || params.uri || ''
    if (!rawUrl || typeof rawUrl !== 'string') {
      return { success: false, error: 'Parameter "url" is required and must be a valid URL string.' }
    }

    const method = (params.method || 'GET').toUpperCase()
    const timeout = Math.min(Math.max(parseInt(params.timeout_ms) || 15000, 1000), 60000)
    const responseType = (params.response_type || 'json').toLowerCase() === 'text' ? 'text' : 'json'

    let requestData = params.body !== undefined ? params.body : params.data
    if (typeof requestData === 'string' && responseType === 'json') {
      try {
        requestData = JSON.parse(requestData)
      } catch (_) {
        // Leave as string if not valid JSON
      }
    }

    const headers = { ...(params.headers || {}) }
    if (typeof requestData === 'object' && requestData !== null && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json'
    }

    const startTime = Date.now()
    try {
      logger.info(`http_request: ${method} ${rawUrl}`)
      const response = await axios({
        url: rawUrl,
        method,
        headers,
        data: ['GET', 'HEAD'].includes(method) ? undefined : requestData,
        timeout,
        responseType: responseType === 'text' ? 'text' : 'json',
        validateStatus: () => true // Allow handling non-2xx status codes without throwing
      })

      const durationMs = Date.now() - startTime
      return {
        success: response.status >= 200 && response.status < 400,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data,
        duration_ms: durationMs
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      logger.error(`http_request failed: ${err.message}`)
      return {
        success: false,
        status: err.response?.status || null,
        error: err.message,
        data: err.response?.data || null,
        duration_ms: durationMs
      }
    }
  }
}
