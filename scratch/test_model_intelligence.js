const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { queryOllama } = require('../util/ollama');
const fs = require('fs');

async function runTest() {
    console.log("Starting Large Context Speed Test for gemma4:e2b...");
    console.log("Window Size: 8192 tokens");

    // 1. Prepare Prompt
    const systemPrompt = fs.readFileSync(path.join(__dirname, '../config/system_prompt.txt'), 'utf8');
    
    // Create 40 "long" dummy messages to fill a significant chunk of context
    const dummyMessages = [];
    for (let i = 0; i < 40; i++) {
        dummyMessages.push({ 
            role: i % 2 === 0 ? 'user' : 'assistant', 
            content: `This is a long message to fill context. Message number ${i}. We are discussing a complex topic involving server management, AI logic, and the future of human-machine interaction in the context of the Skynet project on the CruiseBrantley server. The goal is stability and high performance.`
        });
    }

    const userMessage = "summarize the key points of our long discussion above and then remember that @sirian is actually a level 51 wizard now.";
    
    const messages = [
        { role: 'system', content: systemPrompt },
        ...dummyMessages,
        { role: 'user', content: userMessage }
    ];

    console.log(`Sending prompt with ${messages.length} messages to Local Model...`);
    
    try {
        const start = Date.now();
        // Force Level 2 (Local) with 8k context
        const responseData = await queryOllama('/api/chat', { 
            messages,
            options: {
                num_ctx: 8192,
                temperature: 0.7
            }
        }, 2);
        const end = Date.now();

        const content = responseData.message?.content || "";
        console.log(`\n--- AI RESPONSE (${((end - start)/1000).toFixed(2)}s) ---`);
        console.log(content.substring(0, 500) + (content.length > 500 ? "..." : ""));
        console.log("-----------------------------\n");

        if (content.includes("RUN_COMMAND")) {
            console.log("✅ SUCCESS: Tool call still triggered under heavy context.");
        } else {
            console.log("❌ WARNING: Model did not trigger tool call. Might be context dilution.");
        }

    } catch (err) {
        console.error("Test failed with error:", err.message);
    }
}

runTest();
