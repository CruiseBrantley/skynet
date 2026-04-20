const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { queryOllama } = require('../util/ollama');
const fs = require('fs');
const executor = require('../util/ActionExecutor');

async function runTest() {
    console.log("Starting Tool Discovery Test...");

    // 1. Prepare Prompt
    const systemPromptOrig = fs.readFileSync(path.join(__dirname, '../config/system_prompt.txt'), 'utf8');
    
    // Simulate the chat.js logic of listing actions
    const actionList = executor.listActions().map(a => `- ${a.name}: ${a.description} (JSON Params: ${JSON.stringify(a.schema)})`).join('\n');
    const systemPrompt = `${systemPromptOrig}\n\nAvailable Commands & Actions:\n${actionList}`;

    const userMessage = "Can you schedule a recurring poll for channel 580867049006301214 every Saturday at 10am to check attendance for dnd?";
    
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
    ];

    console.log("Querying model for scheduling task...");
    
    try {
        const start = Date.now();
        const responseData = await queryOllama('/api/chat', { 
            messages,
            options: { num_ctx: 8192, temperature: 0.7 }
        }, 2); // Level 2: Local
        const end = Date.now();

        const content = responseData.message?.content || "";
        console.log(`\n--- AI RESPONSE (${((end - start)/1000).toFixed(2)}s) ---`);
        console.log(content);
        console.log("-----------------------------\n");

        if (content.includes("schedule_task")) {
            console.log("✅ SUCCESS: Model correctly found and used the new schedule_task action!");
        } else {
            console.log("❌ FAILURE: Model still doesn't think it can schedule.");
        }

    } catch (err) {
        console.error("Test failed:", err.message);
    }
}

runTest();
