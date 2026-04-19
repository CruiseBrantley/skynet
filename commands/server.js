const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const dgram = require('dgram');
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

/**
 * Queries the server via Steam A2S_INFO protocol to get full server info.
 */
function getServerInfo(host, port) {
    return new Promise((resolve, reject) => {
        const client = dgram.createSocket('udp4');
        const query = Buffer.from([
            0xFF, 0xFF, 0xFF, 0xFF, 
            0x54, 0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20, 
            0x45, 0x6E, 0x67, 0x69, 0x6E, 0x65, 0x20, 0x51, 
            0x75, 0x65, 0x72, 0x79, 0x00 
        ]);

        let resolved = false;
        client.on('message', (msg) => {
            if (resolved) return;
            resolved = true;
            client.close();
            try {
                let offset = 6;
                const readString = () => {
                    let end = msg.indexOf(0, offset);
                    let str = msg.toString('utf8', offset, end);
                    offset = end + 1;
                    return str;
                };

                const info = {
                    name: readString(),
                    map: readString(),
                    folder: readString(),
                    game: readString(),
                };

                offset += 2; // ID
                info.players = msg.readUInt8(offset);
                offset += 1;
                info.maxPlayers = msg.readUInt8(offset);
                offset += 1;
                info.bots = msg.readUInt8(offset);
                offset += 1;
                info.serverType = String.fromCharCode(msg.readUInt8(offset));
                offset += 1;
                info.environment = String.fromCharCode(msg.readUInt8(offset));
                offset += 1;
                info.visibility = msg.readUInt8(offset);
                offset += 1;
                info.vac = msg.readUInt8(offset);
                offset += 1;
                info.version = readString();

                resolve(info);
            } catch (err) {
                reject(err);
            }
        });

        client.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                client.close();
                reject(err);
            }
        });

        client.send(query, port, host, (err) => {
            if (err && !resolved) {
                resolved = true;
                client.close();
                reject(err);
            }
        });

        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                client.close();
                resolve(null);
            }
        }, 2000);
    });
}

module.exports = {
    // Exported for testing
    _getServerInfo: getServerInfo,
    _getBuildID: getBuildID,
    _formatElapsed: formatElapsed,
    _steamApps: steamApps,

    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('Manage dedicated game servers')
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('status')
               .setDescription('Check detailed status and performance of a server')
               .addStringOption(opt =>
                    opt.setName('name')
                       .setDescription('The server to check')
                       .setRequired(true)
                       .addChoices(...steamApps.map(app => ({ name: app.name, value: app.key })))
                )
        )
        .addSubcommand(sub =>
            sub.setName('update')
               .setDescription('Update and restart a server')
               .addStringOption(opt =>
                    opt.setName('name')
                       .setDescription('The server to update')
                       .setRequired(true)
                       .addChoices(...steamApps.map(app => ({ name: app.name, value: app.key })))
                )
               .addBooleanOption(opt =>
                    opt.setName('force')
                       .setDescription('Force restart even if players are online')
                       .setRequired(false)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();
        const startTime = Date.now();
        const sub = interaction.options.getSubcommand();
        const name = interaction.options.getString('name');
        const app = steamApps.find(a => a.key === name);

        if (!app) {
            return interaction.editReply(`❌ Error: Application definition for \`${name}\` not found.`);
        }

        // Guild restriction
        if (app.guildId && interaction.guildId !== app.guildId) {
            return interaction.editReply(`❌ Error: This server is not authorized to manage the **${app.name}** game server.`);
        }

        const hostIp = SSH_HOST.split('@')[1];

        // --- SUBCOMMAND: STATUS ---
        if (sub === 'status') {
            try {
                const info = app.queryPort ? await getServerInfo(hostIp, app.queryPort) : null;
                
                // Get resource usage via SSH
                let resources = "Unknown";
                try {
                    const resOutput = await runSSH(`tasklist /FI "IMAGENAME eq ${app.processName}" /NH /FO CSV`);
                    if (resOutput && resOutput.toLowerCase().includes(app.processName.toLowerCase())) {
                        const parts = resOutput.split('","');
                        if (parts.length >= 5) {
                            resources = parts[4].replace('"', '').trim();
                        } else {
                            resources = "Running";
                        }
                    } else {
                        resources = "Offline";
                    }
                } catch (resErr) {
                    logger.warn(`Failed to get resource usage for ${app.name}: ${resErr.message}`);
                }

                const embed = new EmbedBuilder()
                    .setTitle(`${app.name} Server Status`)
                    .setColor(info ? 0x00FF00 : 0xFF0000)
                    .setTimestamp();

                if (info) {
                    embed.addFields(
                        { name: 'Status', value: '🟢 Online', inline: true },
                        { name: 'Players', value: `\`${info.players} / ${info.maxPlayers}\``, inline: true },
                        { name: 'Map', value: `\`${info.map}\``, inline: true },
                        { name: 'Memory Usage', value: `\`${resources}\``, inline: true },
                        { name: 'Version', value: `\`${info.version}\``, inline: true },
                        { name: 'VAC Secure', value: info.vac ? '🛡️ Yes' : '❌ No', inline: true }
                    );
                    if (info.name) embed.setDescription(`**Server Name**: ${info.name}`);
                } else {
                    embed.addFields(
                        { name: 'Status', value: '🔴 Offline', inline: true },
                        { name: 'Process', value: resources === 'Offline' ? '❌ Not Running' : '⚠️ Unresponsive', inline: true }
                    );
                    if (resources !== 'Offline') {
                        embed.addFields({ name: 'Memory', value: `\`${resources}\``, inline: true });
                    }
                }

                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                logger.error(`Status error: ${err.message}`);
                return interaction.editReply(`❌ Error retrieving status: ${err.message}`);
            }
        }

        // --- SUBCOMMAND: UPDATE ---
        if (sub === 'update') {
            const force = interaction.options.getBoolean('force') || false;
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (force && !isAdmin) {
                return interaction.editReply(`❌ Error: Only administrators can use the \`force\` option.`);
            }

            try {
                // Stage 0: Check for online players
                if (app.queryPort) {
                    await interaction.editReply(`🕵️ **Stage 0/5**: Checking for online players on **${app.name}**...`);
                    const info = await getServerInfo(hostIp, app.queryPort);
                    const playerCount = info ? info.players : 0;

                    if (playerCount > 0 && !force) {
                        return interaction.editReply(
                            `⚠️ **Abort**: There are currently **${playerCount}** player(s) online on **${app.name}**.\n` +
                            (isAdmin 
                                ? `Use \`force: true\` to override.` 
                                : `The server can only be restarted by non-admins when it is empty.`)
                        );
                    }
                    
                    if (playerCount > 0 && force) {
                        await interaction.editReply(`⚠️ **Proceeding with Force**: **${playerCount}** players online, but admin override is active...`);
                    }
                }

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

                if (!updateOutput.includes(`Success! App '${app.appId}'`)) {
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
        }
    },
};
