const { SlashCommandBuilder } = require('discord.js');
const { execFile } = require('child_process');
const logger = require('../logger');

const SSH_KEY = '/Users/cruise/.ssh/openclaw_id_ed25519';
const SSH_HOST = 'cruis@192.168.50.100';
const STEAMCMD = 'C:\\steamcmd\\steamcmd.exe';
const ICARUS_DIR = 'C:\\steamcmd\\steamapps\\common\\Icarus Dedicated Server';

function runSSH(command, { ignoreExitCode = false } = {}) {
    return new Promise((resolve, reject) => {
        execFile('ssh', [
            '-i', SSH_KEY,
            '-o', 'StrictHostKeyChecking=no',
            SSH_HOST,
            command
        ], { timeout: 600000 }, (error, stdout, stderr) => {
            if (error && !ignoreExitCode) {
                error.message += `\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`;
                return reject(error);
            }
            resolve(stdout.trim());
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-icarus')
        .setDescription('Update and restart the Icarus dedicated server'),
    async execute(interaction) {
        await interaction.deferReply();

        try {
            await interaction.editReply('🔄 **Step 1/4**: Checking server status...');

            // Step 1: Check if running
            const taskList = await runSSH('tasklist /FI "IMAGENAME eq IcarusServer.exe"');
            const isRunning = taskList.includes('IcarusServer.exe');

            // Step 2: Stop if running
            if (isRunning) {
                await interaction.editReply('🛑 **Step 2/4**: Server is running, stopping...');
                await runSSH('taskkill /F /IM IcarusServer.exe');
                // Wait a few seconds for the process to exit
                await new Promise(r => setTimeout(r, 5000));
            } else {
                await interaction.editReply('⏭️ **Step 2/4**: Server not running, skipping stop.');
            }

            // Step 3: Update via SteamCMD
            await interaction.editReply('📥 **Step 3/4**: Updating via SteamCMD (this may take a while)...');
            await runSSH(`${STEAMCMD} +login anonymous +app_update 1644960 validate +quit`, { ignoreExitCode: true });

            // Step 4: Start server
            await interaction.editReply('🚀 **Step 4/4**: Starting Icarus server...');
            await runSSH(`powershell -c "Start-Process -FilePath '${ICARUS_DIR}\\IcarusServer.exe' -ArgumentList '-log' -WorkingDirectory '${ICARUS_DIR}'"`);

            await interaction.editReply('✅ **Icarus server updated and restarted successfully!**');
        } catch (err) {
            logger.error(`Icarus update error: ${err.message}`);
            try {
                await interaction.editReply(`❌ Error during Icarus update: ${err.message}`);
            } catch (e) {
                await interaction.channel.send(`❌ Error during Icarus update: ${err.message}`);
            }
        }
    },
};
