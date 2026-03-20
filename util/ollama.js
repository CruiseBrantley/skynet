const axios = require('axios');
const logger = require('../logger');

async function checkOllamaOnline(url, endpoint) {
    try {
        const baseUrl = url.replace(endpoint, '');
        await axios.get(`${baseUrl}/api/tags`, { timeout: 3000 });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Queries Ollama with automatic failover from remote PC to local fallback.
 * @param {string} endpoint - The API endpoint e.g., '/api/chat' or '/api/generate'
 * @param {object} payload - The request body (e.g. messages: [], prompt: "")
 * @param {boolean} isBackup - Forces query target to local 127.0.0.1
 * @returns {Promise<object>} The raw Axios response data
 */
async function queryOllama(endpoint, payload, isBackup = false) {
    const url = isBackup ? `http://127.0.0.1:11434${endpoint}` : `http://192.168.50.182:11434${endpoint}`;
    const model = isBackup ? 'qwen3.5:4b' : 'gemma3:27b';

    // Pre-flight check before waiting 300s
    if (!isBackup) {
        const isOnline = await checkOllamaOnline(url, endpoint);
        if (!isOnline) {
            logger.info(`Primary Ollama PC is offline or unreachable. Skipping to local.`);
            return queryOllama(endpoint, payload, true);
        }
    }

    const timeoutMs = 300000; // 5 minutes timeout safety

    const finalPayload = {
        ...payload,
        model: model,
        stream: false
    };



    try {
        const response = await axios.post(url, finalPayload, { timeout: timeoutMs });
        return response.data;
    } catch (err) {
        if (!isBackup) {
            logger.info(`Primary Ollama failed, falling back to local: ${err.message}`);
            return queryOllama(endpoint, payload, true);
        }
        throw err;
    }
}

module.exports = { queryOllama };
