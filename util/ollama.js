const net = require('net');
const axios = require('axios');
const logger = require('../logger');

/**
 * Perform a quick TCP connection check.
 */
function checkPortOpen(host, port, timeout = 1000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const onError = () => {
            socket.destroy();
            resolve(false);
        };

        socket.setTimeout(timeout);
        socket.once('error', onError);
        socket.once('timeout', onError);

        socket.connect(port, host, () => {
            socket.end();
            resolve(true);
        });
    });
}

async function checkOllamaOnline(url, endpoint) {
    try {
        const baseUrl = url.replace(endpoint, '');
        await axios.get(`${baseUrl}/api/tags`, { timeout: 1000 });
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
    // If isBackup is true, we skip the primary PC and jump to the first fallback (Local)
    if (fallbackLevel === true) fallbackLevel = 1;
    if (fallbackLevel === false) fallbackLevel = 0;

    const timeoutMs = 300000; // 5 minutes timeout safety

    // Level 1: Gemini API Tier (The first reliable fail-over)
    if (fallbackLevel === 1) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            logger.error("GEMINI_API_KEY is not configured in .env and fallback reached Level 1.");
            return queryOllama(endpoint, payload, 2); // Drop to local if API key is missing
        }

        logger.info(`Triggering Level 1 fallback: Gemini-3.1-flash-lite for ${endpoint}`);

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
                    model: 'gemini-3.1-flash-lite-preview',
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
            logger.error(`Gemini fallback failed: ${err.message}. Dropping to Level 2 (Local).`);
            return queryOllama(endpoint, payload, 2);
        }
    }

    // Level 2: Local Fallback (The final fail-safe)
    // Model: gemma4:e4b (keeps in RAM for fast responses)
    if (fallbackLevel >= 2) {
        const localUrl = `http://127.0.0.1:11434${endpoint}`;
        const localModel = 'gemma4:e4b';

        logger.info(`Triggering Level 2 fallback: Local Ollama (${localModel}) for ${endpoint}`);

        // Try to start local Ollama if offline
        let isOnline = await checkPortOpen('127.0.0.1', 11434, 1000);
        if (!isOnline) {
            logger.info(`Local Ollama is offline. Attempting to start with 'open -a Ollama'...`);
            const { exec } = require('child_process');
            exec('open -a Ollama');
            // Give it more time to spin up if it was completely closed
            for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 2000));
                isOnline = await checkPortOpen('127.0.0.1', 11434, 1000);
                if (isOnline) break;
            }
        }

        try {
            // Debug: log the full payload to see the system prompt and context for the local model
            if (payload.messages) {
                logger.debug(`Local Model Payload (${localModel}): ${JSON.stringify(payload.messages, null, 2)}`);
            }
            const response = await axios.post(localUrl, { ...payload, model: localModel, stream: false }, { timeout: timeoutMs * 1.5 });
            return response.data;
        } catch (err) {
            logger.error(`Final local fallback failed: ${err.message}`);
            throw new Error("All fallback tiers (Remote, Gemini, Local) are unreachable.");
        }
    }

    // Level 0: Primary Remote Workstation
    const remoteHost = '192.168.50.182';
    const remotePort = 11434;
    const remoteUrl = `http://${remoteHost}:${remotePort}${endpoint}`;
    const remoteModel = 'gemma4:26b';

    // Quick TCP pre-flight check (1s timeout)
    const isOnline = await checkPortOpen(remoteHost, remotePort, 1000);
    if (!isOnline) {
        logger.info(`Primary Ollama PC is unreachable via TCP. Skipping to Level 1 (Local).`);
        return queryOllama(endpoint, payload, 1);
    }
    try {
        const response = await axios.post(remoteUrl, { ...payload, model: remoteModel, stream: false }, { timeout: timeoutMs });
        return response.data;
    } catch (err) {
        logger.info(`Primary Ollama failed, falling back to Local: ${err.message}`);
        return queryOllama(endpoint, payload, 1);
    }
}

module.exports = { queryOllama };
