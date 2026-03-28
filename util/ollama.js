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
 * Queries Ollama with automatic failover from remote PC to Gemini to local fallback.
 * @param {string} endpoint - The API endpoint e.g., '/api/chat' or '/api/generate'
 * @param {object} payload - The request body (e.g. messages: [], prompt: "")
 * @param {number|boolean} fallbackLevel - 0: remote Ollama, 1: Gemini, 2: local Ollama
 * @returns {Promise<object>} The normalized response data
 */
async function queryOllama(endpoint, payload, fallbackLevel = 0) {
    // Handle backwards compatibility for boolean isBackup
    // If isBackup is true, we skip the primary PC and jump to the first fallback (Gemini)
    if (fallbackLevel === true) fallbackLevel = 1;
    if (fallbackLevel === false) fallbackLevel = 0;

    const timeoutMs = 300000; // 5 minutes timeout safety

    // Level 1: Gemini Fallback (Now the primary fallback)
    if (fallbackLevel === 1) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            logger.error("GEMINI_API_KEY is not configured in .env. Skipping to local fallback.");
            return queryOllama(endpoint, payload, 2);
        }
        
        logger.info(`Triggering Level 1 fallback: Gemini-3-Flash for ${endpoint}`);
        
        let geminiMessages = [];
        if (payload.messages) {
            geminiMessages = payload.messages;
        } else if (payload.prompt) {
            geminiMessages = [{ role: 'user', content: payload.prompt }];
        }

        try {
            const response = await axios.post(
                'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
                {
                    model: 'gemini-1.5-flash', // Updated to latest flash model name standard
                    messages: geminiMessages,
                    stream: false
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: timeoutMs
                }
            );

            if (response.data.choices && response.data.choices[0]) {
                const content = response.data.choices[0].message.content;
                if (endpoint === '/api/generate') {
                    return { response: content };
                }
                return { message: { role: 'assistant', content: content } };
            }
            throw new Error("Invalid response structure from Gemini API");
        } catch (err) {
            logger.info(`Gemini fallback failed, dropping to local: ${err.message}`);
            return queryOllama(endpoint, payload, 2);
        }
    }

    // Level 2: Local Fallback (The final fail-safe)
    if (fallbackLevel >= 2) {
        const localUrl = `http://127.0.0.1:11434${endpoint}`;
        const localModel = 'qwen2.5:4b';
        
        logger.info(`Triggering Level 2 fallback: Local Ollama (${localModel}) for ${endpoint}`);

        // Try to start local Ollama if offline
        let isOnline = await checkOllamaOnline(localUrl, endpoint);
        if (!isOnline) {
            logger.info(`Local Ollama is offline. Attempting to start with 'open -a Ollama'...`);
            const { exec } = require('child_process');
            exec('open -a Ollama');
            for (let i = 0; i < 5; i++) {
                await new Promise(r => setTimeout(r, 2000));
                isOnline = await checkOllamaOnline(localUrl, endpoint);
                if (isOnline) break;
            }
        }

        if (!isOnline) {
            throw new Error("All fallback tiers (Remote, Gemini, Local) are unreachable.");
        }

        try {
            const response = await axios.post(localUrl, { ...payload, model: localModel, stream: false }, { timeout: timeoutMs });
            return response.data;
        } catch (err) {
            logger.error(`Local fallback failed: ${err.message}`);
            throw err;
        }
    }

    // Level 0: Primary Remote Workstation
    const remoteUrl = `http://192.168.50.182:11434${endpoint}`;
    const remoteModel = 'gemma3:27b';
    
    // Pre-flight check
    const isOnline = await checkOllamaOnline(remoteUrl, endpoint);
    if (!isOnline) {
        logger.info(`Primary Ollama PC is offline. Skipping to Level 1 (Gemini).`);
        return queryOllama(endpoint, payload, 1);
    }
    try {
        const response = await axios.post(remoteUrl, { ...payload, model: remoteModel, stream: false }, { timeout: timeoutMs });
        return response.data;
    } catch (err) {
        logger.info(`Primary Ollama failed, falling back to Gemini: ${err.message}`);
        return queryOllama(endpoint, payload, 1);
    }
}

module.exports = { queryOllama };
