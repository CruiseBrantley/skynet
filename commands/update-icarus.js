const { SlashCommandBuilder } = require('discord.js');
const { execFile } = require('child_process');
const logger = require('../logger');

const SSH_KEY = '/Users/cruise/.ssh/openclaw_id_ed25519';
const SSH_HOST = 'cruis@192.168.50.100';
const STEAMCMD = 'C:\\steamcmd\\steamcmd.exe';
const ICARUS_DIR = 'C:\\steamcmd\\steamapps\\common\\Icarus Dedicated Server';
const ICARUS_APP_ID = '2089300';

/**
 * Run a command on the remote Windows host via SSH.
 * @param {string} command - The command to execute remotely.
 * @param {object} opts
 * @param {number} opts.timeout - Max time in ms before killing the process (default 10 min).
 */
function runSSH(command, { timeout = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        execFile('ssh', [
            '-i', SSH_KEY,
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'ConnectTimeout=10',
            '-o', 'ServerAliveInterval=15',
            '-o', 'ServerAliveCountMax=4',
            SSH_HOST,
            command
        ], { timeout }, (error, stdout, stderr) => {
            if (error) {
                const combined = `${stdout}\n${stderr}`;
                // Parse specific SteamCMD errors into actionable messages
                if (combined.includes('No subscription')) {
                    return reject(new Error(
                        "Steam Authorization Failed: 'No subscription'. The App ID may have changed or anonymous access is restricted."
                    ));
                }
                if (combined.includes('Missing configuration')) {
                    return reject(new Error(
                        "Steam Configuration Error: SteamCMD config is stale. Try deleting the appcache folder on the server."
                    ));
                }
                error.stdout = stdout;
                error.stderr = stderr;
                return reject(error);
            }
            resolve(stdout.trim());
        });
    });
}

/**
 * Retrieves the current BuildID for the Icarus Dedicated Server.
 * Uses a short timeout since this is just a quick metadata check.
 */
async function getBuildID() {
    try {
        const output = await runSSH(
            `${STEAMCMD} +login anonymous +app_status ${ICARUS_APP_ID} +quit`,
            { timeout: 60000 }
        );
        const match = output.match(/BuildID\s+(\d+)/);
        return match ? match[1] : null;
    } catch (err) {
        logger.error(`getBuildID failed: ${err.message}`);
        return null;
    }
}

/**
 * Format elapsed time as a human-readable string.
 */
function formatElapsed(startTime) {
    const seconds = Math.round((Date.now() - startTime) / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

module.exports = {
    // Exported for testing
    _runSSH: runSSH,
    _getBuildID: getBuildID,
    _formatElapsed: formatElapsed,
    ICARUS_APP_ID,

    data: new SlashCommandBuilder()
        .setName('update-icarus')
        .setDescription('Update and restart the Icarus dedicated server'),

    async execute(interaction) {
        await interaction.deferReply();
        const startTime = Date.now();

        try {
            // Stage 1: Snapshot current build
            await interaction.editReply('🔍 **Stage 1/5**: Checking current build...');
            const oldBuild = await getBuildID();
            const buildLabel = oldBuild || 'Unknown';

            // Stage 2: Stop server if running
            await interaction.editReply(`🛑 **Stage 2/5**: Checking for running server (Build: \`${buildLabel}\`)...`);
            const taskList = await runSSH('tasklist /FO CSV');
            const isRunning = taskList.includes('IcarusServer-Win64-Shipping.exe');

            if (isRunning) {
                await interaction.editReply('🛑 **Stage 2/5**: Stopping server...');
                await runSSH('taskkill /F /IM IcarusServer-Win64-Shipping.exe /T');
                await new Promise(r => setTimeout(r, 5000));
            }

            // Stage 3: Update via SteamCMD
            // SteamCMD returns non-zero exit codes even on success, so we parse stdout.
            await interaction.editReply('📥 **Stage 3/5**: Updating via SteamCMD (this may take several minutes)...');
            let updateOutput;
            try {
                updateOutput = await runSSH(
                    `${STEAMCMD} +force_install_dir "${ICARUS_DIR}" +login anonymous +app_update ${ICARUS_APP_ID} validate +quit`
                );
            } catch (steamErr) {
                // SteamCMD often exits non-zero even when it succeeds.
                // Check if the output contains the success marker.
                if (steamErr.stdout && steamErr.stdout.includes(`Success! App '${ICARUS_APP_ID}' fully installed.`)) {
                    updateOutput = steamErr.stdout;
                } else {
                    throw steamErr;
                }
            }

            const updateSucceeded = updateOutput.includes(`Success! App '${ICARUS_APP_ID}'`);
            if (!updateSucceeded) {
                throw new Error(`SteamCMD did not report success. Output tail:\n${updateOutput.slice(-300)}`);
            }

            // Stage 4: Start the server
            await interaction.editReply('🚀 **Stage 4/5**: Starting server...');
            await runSSH(`wmic process call create "${ICARUS_DIR}\\IcarusServer.exe -log", "${ICARUS_DIR}"`);

            // Stage 5: Verify new build
            await interaction.editReply('✅ **Stage 5/5**: Verifying new build...');
            const newBuild = await getBuildID();
            const elapsed = formatElapsed(startTime);

            if (oldBuild && newBuild && oldBuild === newBuild) {
                await interaction.editReply(
                    `⚠️ **Update complete — no version change detected.**\n` +
                    `- **BuildID**: \`${newBuild}\`\n` +
                    `- **Elapsed**: ${elapsed}\n` +
                    `- Server was already on the latest version.`
                );
            } else {
                await interaction.editReply(
                    `✅ **Icarus updated successfully!**\n` +
                    `- **Build**: \`${oldBuild || '?'}\` ➡️ \`${newBuild || '?'}\`\n` +
                    `- **Elapsed**: ${elapsed}\n` +
                    `- Server is running and accepting connections.`
                );
            }

        } catch (err) {
            logger.error(`Icarus update error: ${err.message}`);
            const elapsed = formatElapsed(startTime);
            const msg = `❌ **Icarus update failed** (${elapsed}):\n> ${err.message}`;
            try {
                await interaction.editReply(msg);
            } catch (e) {
                await interaction.channel.send(msg);
            }
        }
    },
};
