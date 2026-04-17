const { SlashCommandBuilder } = require('discord.js');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const SSH_KEY = process.env.STEAM_SSH_KEY;
const SSH_HOST = process.env.STEAM_SSH_HOST;
const STEAMCMD = process.env.STEAM_STEAMCMD_PATH;

// Load app configurations
const appConfigPath = path.join(__dirname, '../config/steam_apps.json');
let steamApps = [];
try {
    const data = fs.readFileSync(appConfigPath, 'utf8');
    steamApps = JSON.parse(data);
} catch (err) {
    logger.error(`Failed to load steam_apps.json: ${err.message}`);
}

/**
 * Run a command on the remote Windows host via SSH.
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
                if (combined.includes('No subscription')) {
                    return reject(new Error("Steam Authorization Failed: 'No subscription'."));
                }
                if (combined.includes('Missing configuration')) {
                    return reject(new Error("Steam Configuration Error: SteamCMD config is stale."));
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
 * Retrieves the current BuildID for a Steam App.
 */
async function getBuildID(appId) {
    try {
        const output = await runSSH(
            `${STEAMCMD} +login anonymous +app_status ${appId} +quit`,
            { timeout: 60000 }
        );
        const match = output.match(/BuildID\s+(\d+)/);
        return match ? match[1] : null;
    } catch (err) {
        logger.error(`getBuildID for ${appId} failed: ${err.message}`);
        return null;
    }
}

function formatElapsed(startTime) {
    const seconds = Math.round((Date.now() - startTime) / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

module.exports = {
    // Exported for testing
    _getBuildID: getBuildID,
    _formatElapsed: formatElapsed,
    _steamApps: steamApps,

    data: new SlashCommandBuilder()
        .setName('update-server')
        .setDescription('Update and restart a dedicated game server')
        .addStringOption(option =>
            option.setName('app')
                .setDescription('The game server to update')
                .setRequired(true)
                .addChoices(
                    ...steamApps.map(app => ({ name: app.name, value: app.key }))
                )),

    async execute(interaction) {
        await interaction.deferReply();
        const startTime = Date.now();
        const appKey = interaction.options.getString('app');
        const app = steamApps.find(a => a.key === appKey);

        if (!app) {
            return interaction.editReply(`❌ Error: Application definition for \`${appKey}\` not found.`);
        }

        try {
            // Stage 1: Snapshot current build
            await interaction.editReply(`🔍 **Stage 1/5**: Checking current build for **${app.name}**...`);
            const oldBuild = await getBuildID(app.appId);
            const buildLabel = oldBuild || 'Unknown';

            // Stage 2: Stop server if running
            await interaction.editReply(`🛑 **Stage 2/5**: Checking for running server (Build: \`${buildLabel}\`)...`);
            const taskList = await runSSH('tasklist /FO CSV');
            const isRunning = taskList.includes(app.processName);

            if (isRunning) {
                await interaction.editReply(`🛑 **Stage 2/5**: Stopping **${app.name}** server...`);
                await runSSH(`taskkill /F /IM ${app.processName} /T`);
                await new Promise(r => setTimeout(r, 5000));
            }

            // Stage 3: Update via SteamCMD
            await interaction.editReply(`📥 **Stage 3/5**: Updating **${app.name}** via SteamCMD...`);
            let updateOutput;
            try {
                updateOutput = await runSSH(
                    `${STEAMCMD} +force_install_dir "${app.installDir}" +login anonymous +app_update ${app.appId} validate +quit`
                );
            } catch (steamErr) {
                if (steamErr.stdout && steamErr.stdout.includes(`Success! App '${app.appId}' fully installed.`)) {
                    updateOutput = steamErr.stdout;
                } else {
                    throw steamErr;
                }
            }

            const updateSucceeded = updateOutput.includes(`Success! App '${app.appId}'`);
            if (!updateSucceeded) {
                throw new Error(`SteamCMD did not report success for App ${app.appId}.`);
            }

            // Stage 4: Start the server
            await interaction.editReply(`🚀 **Stage 4/5**: Starting **${app.name}** server...`);
            await runSSH(`wmic process call create "${app.installDir}\\${app.executable}", "${app.installDir}"`);

            // Stage 5: Verify new build
            await interaction.editReply('✅ **Stage 5/5**: Verifying new build...');
            const newBuild = await getBuildID(app.appId);
            const elapsed = formatElapsed(startTime);

            if (oldBuild && newBuild && oldBuild === newBuild) {
                await interaction.editReply(
                    `⚠️ **Update complete — no version change detected.**\n` +
                    `- **App**: ${app.name}\n` +
                    `- **BuildID**: \`${newBuild}\`\n` +
                    `- **Elapsed**: ${elapsed}`
                );
            } else {
                await interaction.editReply(
                    `✅ **${app.name} updated successfully!**\n` +
                    `- **Build**: \`${oldBuild || '?'}\` ➡️ \`${newBuild || '?'}\`\n` +
                    `- **Elapsed**: ${elapsed}`
                );
            }

        } catch (err) {
            logger.error(`${app.name} update error: ${err.message}`);
            const elapsed = formatElapsed(startTime);
            await interaction.editReply(`❌ **${app.name} update failed** (${elapsed}):\n> ${err.message}`);
        }
    },
};
