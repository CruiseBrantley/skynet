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
 * Queries Ollama with automatic failover from remote PC to local fallback to Gemini.
 * @param {string} endpoint - The API endpoint e.g., '/api/chat' or '/api/generate'
 * @param {object} payload - The request body (e.g. messages: [], prompt: "")
 * @param {number|boolean} fallbackLevel - 0: remote Ollama, 1: local Ollama, 2: Gemini
 * @returns {Promise<object>} The normalized response data
 */
async function queryOllama(endpoint, payload, fallbackLevel = 0) {
    // Handle backwards compatibility for boolean isBackup
    if (fallbackLevel === true) fallbackLevel = 1;
    if (fallbackLevel === false) fallbackLevel = 0;

    const timeoutMs = 300000; // 5 minutes timeout safety

    // Level 2: Gemini Fallback
    if (fallbackLevel >= 2) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            logger.error("GEMINI_API_KEY is not configured in .env");
            throw new Error("Gemini fallback failed: API Key missing");
        }
        
        logger.info(`Triggering Level 2 fallback: Gemini-Flash for ${endpoint}`);
        
        // Translate payload for OpenAI-compatible endpoint
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
                    model: 'gemini-3-flash',
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
            logger.error(`Gemini fallback failed: ${err.message}`);
            throw err;
        }
    }

    const url = fallbackLevel === 1 ? `http://127.0.0.1:11434${endpoint}` : `http://192.168.50.182:11434${endpoint}`;
    const model = fallbackLevel === 1 ? 'qwen3.5:4b' : 'gemma3:27b';

    // Pre-flight check before waiting 300s
    if (fallbackLevel === 0) {
        const isOnline = await checkOllamaOnline(url, endpoint);
        if (!isOnline) {
            logger.info(`Primary Ollama PC is offline or unreachable. Skipping to local.`);
            return queryOllama(endpoint, payload, 1);
        }
    }

    if (fallbackLevel === 1) {
        let isOnline = await checkOllamaOnline(url, endpoint);
        if (!isOnline) {
            logger.info(`Local Ollama is offline. Attempting to start with 'open -a Ollama'...`);
            const { exec } = require('child_process');
            exec('open -a Ollama');
            
            // Wait up to 10 seconds for it to start
            for (let i = 0; i < 5; i++) {
                await new Promise(r => setTimeout(r, 2000)); // wait 2s
                isOnline = await checkOllamaOnline(url, endpoint);
                if (isOnline) {
                    logger.info(`Local Ollama is now online!`);
                    break;
                }
            }
        }
        if (!isOnline) {
            logger.warn(`Local Ollama failed to start. Skipping to Gemini.`);
            return queryOllama(endpoint, payload, 2);
        }
    }


    const finalPayload = {
        ...payload,
        model: model,
        stream: false
    };

    try {
        const response = await axios.post(url, finalPayload, { timeout: timeoutMs });
        return response.data;
    } catch (err) {
        if (fallbackLevel === 0) {
            logger.info(`Primary Ollama failed, falling back to local: ${err.message}`);
            return queryOllama(endpoint, payload, 1);
        } else if (fallbackLevel === 1) {
            logger.info(`Local Ollama failed, falling back to Gemini: ${err.message}`);
            return queryOllama(endpoint, payload, 2);
        }
        throw err;
    }
}

module.exports = { queryOllama };
