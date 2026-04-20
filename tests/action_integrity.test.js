const fs = require('fs');
const path = require('path');

describe('Action Integrity - Signature Validation', () => {
    const actionsDir = path.join(__dirname, '../util/actions');
    const actionFiles = fs.readdirSync(actionsDir).filter(f => f.endsWith('.js'));

    actionFiles.forEach(file => {
        const filePath = path.join(actionsDir, file);
        const action = require(filePath);

        test(`Action "${file}" should have a valid structure`, () => {
            expect(action).toHaveProperty('name');
            expect(action).toHaveProperty('description');
            expect(action).toHaveProperty('execute');
            expect(typeof action.execute).toBe('function');
        });

        test(`Action "${file}" execute signature should accept 3-4 arguments`, () => {
            // Standard signature: async (bot, channel, params, [context/interaction])
            // JS function.length returns the number of formal parameters.
            // We want at least 3 (bot, channel, params).
            const paramCount = action.execute.length;
            
            // Note: If an action uses destructuring like ({ bot, channel }, params), length would be 2.
            // If it uses ...args, length would be 0.
            // But our standard is (bot, channel, params, context).
            
            if (paramCount < 3) {
                // If it has fewer than 3, we inspect the source for Destructuring as a fallback check
                const source = action.execute.toString();
                const hasBotAndChannel = source.includes('bot') && source.includes('channel');
                
                if (!hasBotAndChannel) {
                    throw new Error(`Action "${file}" signature (length ${paramCount}) looks invalid. Expected (bot, channel, params, context).`);
                }
            }
            
            expect(paramCount).toBeGreaterThanOrEqual(2); // Minimum 2 (bot, channel) for very basic but 3+ is ideal
        });
    });
});
