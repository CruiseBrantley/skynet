
const fs = require('fs');
const path = require('path');

describe('Command Consistency', () => {
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    test('all commands using MessageFlags must import it from discord.js', () => {
        commandFiles.forEach(file => {
            const filePath = path.join(commandsPath, file);
            const content = fs.readFileSync(filePath, 'utf8');

            if (content.includes('MessageFlags')) {
                // Check if MessageFlags is in the require('discord.js') line
                const discordImportMatch = content.match(/const\s+\{([^}]*)\}\s*=\s*require\(['"]discord\.js['"]\)/);
                if (discordImportMatch) {
                    const imports = discordImportMatch[1].split(',').map(i => i.trim());
                    if (!imports.includes('MessageFlags')) {
                        throw new Error(`File ${file} uses MessageFlags but does not import it from discord.js`);
                    }
                } else {
                    // Maybe it's imported differently? Let's check for any mention of require('discord.js')
                    if (!content.includes("require('discord.js')") && !content.includes('require("discord.js")')) {
                         throw new Error(`File ${file} uses MessageFlags but does not seem to import discord.js at all`);
                    }
                }
            }
        });
    });

    test('all commands have data and execute properties', () => {
        commandFiles.forEach(file => {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);
            
            expect(command).toHaveProperty('data');
            expect(command).toHaveProperty('execute');
            expect(command.data).toHaveProperty('name');
        });
    });
});
