const actionExecutor = require('../util/ActionExecutor');
const fs = require('fs');
const path = require('path');

describe('ActionExecutor Structural Linter', () => {
    test('rejects actions containing poll_media', () => {
        const result = actionExecutor.registerAction(
            'bad_poll_action', 
            'test', 
            {}, 
            'await channel.send({ poll: { answers: [{ poll_media: { text: "No" }}] } });'
        );
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Structural Error');
        expect(result.error).toContain('poll_media');
    });

    test('accepts actions with correct poll structure', async () => {
        // Use a different name for each test to avoid conflicts in CUSTOM_DIR
        const result = actionExecutor.registerAction(
            'good_poll_action', 
            'test', 
            {}, 
            'await channel.send({ poll: { question: { text: "Yes?" }, answers: [{ text: "Yes" }] } });'
        );
        
        expect(result.success).toBe(true);
        
        // Cleanup
        actionExecutor.deleteAction('good_poll_action');
    });

    test('rejects modify containing poll_media', () => {
        // First create a good one
        actionExecutor.registerAction('temp_mod_action', 'test', {}, 'console.log("hi");');
        
        const result = actionExecutor.modifyAction('temp_mod_action', {
            code: 'await channel.send({ poll: { answers: [{ poll_media: { text: "No" }}] } });'
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Structural Error');
        
        // Cleanup
        actionExecutor.deleteAction('temp_mod_action');
    });
});
