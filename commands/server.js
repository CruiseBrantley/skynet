const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const dgram = require('dgram')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const logger = require('../logger')

const SSH_KEY = process.env.STEAM_SSH_KEY
const SSH_HOST = process.env.STEAM_SSH_HOST
const STEAMCMD = process.env.STEAM_STEAMCMD_PATH

// Load app configurations
const appConfigPath = path.join(__dirname, '../config/steam_apps.json')
let steamApps = []
try {
  const data = fs.readFileSync(appConfigPath, 'utf8')
  steamApps = JSON.parse(data)
} catch (err) {
  logger.error(`Failed to load steam_apps.json: ${err.message}`)
}

/**
 * Run a command on the remote Windows host via SSH.
 */
function runSSH (command, { timeout = 600000 } = {}) {
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
        const combined = `${stdout}\n${stderr}`
        if (combined.includes('No subscription')) {
          return reject(new Error("Steam Authorization Failed: 'No subscription'."))
        }
        if (combined.includes('Missing configuration')) {
          return reject(new Error('Steam Configuration Error: SteamCMD config is stale.'))
        }
        error.stdout = stdout
        error.stderr = stderr
        return reject(error)
      }
      resolve(stdout.trim())
    })
  })
}

/**
 * Retrieves the current BuildID for a Steam App.
 */
async function getBuildID (app) {
  try {
    const output = await runSSH(
            `${STEAMCMD} +force_install_dir "${app.installDir}" +login anonymous +app_status ${app.appId} +quit`,
            { timeout: 60000 }
    )
    const match = output.match(/BuildID\s+(\d+)/)
    return match ? match[1] : null
  } catch (err) {
    logger.error(`getBuildID for ${app.appId} failed: ${err.message}`)
    return null
  }
}

function formatElapsed (startTime) {
  const seconds = Math.round((Date.now() - startTime) / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/**
 * Queries the server via Steam A2S_INFO protocol to get full server info.
 */
function getServerInfo (host, port) {
  // ... (logic remains same, just placing helper here if needed later)
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4')
    const query = Buffer.from([
      0xFF, 0xFF, 0xFF, 0xFF,
      0x54, 0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20,
      0x45, 0x6E, 0x67, 0x69, 0x6E, 0x65, 0x20, 0x51,
      0x75, 0x65, 0x72, 0x79, 0x00
    ])

    let resolved = false

    const sendQuery = (payload) => {
      client.send(payload, port, host, (err) => {
        if (err && !resolved) {
          resolved = true
          client.close()
          reject(err)
        }
      })
    }

    client.on('message', (msg) => {
      if (resolved) return

      if (msg.length === 9 && msg[4] === 0x41) {
        const challenge = msg.slice(5)
        const challengeQuery = Buffer.concat([query, challenge])
        sendQuery(challengeQuery)
        return
      }

      resolved = true
      client.close()
      try {
        let offset = 6
        const readString = () => {
          const end = msg.indexOf(0, offset)
          if (end === -1) return ''
          const str = msg.toString('utf8', offset, end)
          offset = end + 1
          return str
        }

        const info = {
          name: readString(),
          map: readString(),
          folder: readString(),
          game: readString()
        }

        offset += 2 // ID
        info.players = msg.readUInt8(offset)
        offset += 1
        info.maxPlayers = msg.readUInt8(offset)
        offset += 1
        info.bots = msg.readUInt8(offset)
        offset += 1
        info.serverType = String.fromCharCode(msg.readUInt8(offset))
        offset += 1
        info.environment = String.fromCharCode(msg.readUInt8(offset))
        offset += 1
        info.visibility = msg.readUInt8(offset)
        offset += 1
        info.vac = msg.readUInt8(offset)
        offset += 1
        info.version = readString()

        resolve(info)
      } catch (err) {
        reject(err)
      }
    })

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true
        client.close()
        reject(err)
      }
    })

    sendQuery(query)

    setTimeout(() => {
      if (!resolved) {
        resolved = true
        client.close()
        resolve(null)
      }
    }, 5000)
  })
}

function getUpdateEmbed (app, stages, error = null, finalResult = null) {
  const embed = new EmbedBuilder()
    .setTitle(`🔄 Updating ${app.name}`)
    .setColor(error ? 0xFF0000 : (finalResult ? 0x00FF00 : 0x0099FF))
    .setTimestamp()

  let description = ''
  stages.forEach((s, i) => {
    let icon = '⚪'
    if (s.status === 'running') icon = '🔵'
    if (s.status === 'done') icon = '✅'
    if (s.status === 'failed') icon = '❌'

    description += `${icon} **Stage ${i}**: ${s.name}\n`
  })

  if (error) {
    description += `\n❌ **Error**: ${error}`
  } else if (finalResult) {
    description += `\n\n${finalResult}`
  } else {
    description += '\n*Please wait, Skynet is managing the process...*'
  }

  embed.setDescription(description)
  return embed
}

async function fetchStatusPayload (app) {
  const hostIp = SSH_HOST.split('@')[1]
  const info = app.queryPort ? await getServerInfo(hostIp, app.queryPort) : null

  // Get resource usage via SSH
  let resources = 'Unknown'
  try {
    const resOutput = await runSSH(`tasklist /FI "IMAGENAME eq ${app.processName}" /NH /FO CSV`)
    if (resOutput && resOutput.toLowerCase().includes(app.processName.toLowerCase())) {
      const parts = resOutput.split('","')
      if (parts.length >= 5) {
        resources = parts[4].replace('"', '').trim()
      } else {
        resources = 'Running'
      }
    } else {
      resources = 'Offline'
    }
  } catch (resErr) {
    logger.warn(`Failed to get resource usage for ${app.name}: ${resErr.message}`)
  }

  let displayVersion = info ? info.version : null
  if (info && app.versionCommand && (displayVersion === '1.0.0.0' || !displayVersion)) {
    try {
      const customVer = await runSSH(app.versionCommand)
      const verMatch = customVer.match(/version=([\d.]+)/)
      if (verMatch) displayVersion = verMatch[1]
    } catch (verErr) {
      logger.warn(`Failed to run custom version command for ${app.name}: ${verErr.message}`)
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`${app.name} Server Status`)
    .setColor(info ? 0x00FF00 : 0xFF0000)
    .setTimestamp()

  if (info) {
    embed.addFields(
      { name: 'Status', value: '🟢 Online', inline: true },
      { name: 'Players', value: `\`${info.players} / ${info.maxPlayers}\``, inline: true },
      { name: 'Map', value: `\`${info.map}\``, inline: true },
      { name: 'Memory', value: `\`${resources}\``, inline: true },
      { name: 'Version', value: `\`${displayVersion}\``, inline: true },
      { name: 'VAC Secure', value: info.vac ? '🛡️ Yes' : '❌ No', inline: true }
    )
    if (info.name) embed.setDescription(`**Server Name**: ${info.name}`)
  } else {
    embed.addFields(
      { name: 'Status', value: '🔴 Offline', inline: true },
      { name: 'Process', value: resources === 'Offline' ? '❌ Not Running' : '⚠️ Unresponsive', inline: true }
    )
    if (resources !== 'Offline') {
      embed.addFields({ name: 'Memory', value: `\`${resources}\``, inline: true })
    }
  }

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`server_refresh_${app.key}`)
        .setLabel('Refresh Status')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔄'),
      new ButtonBuilder()
        .setCustomId(`server_update_${app.key}`)
        .setLabel('Update Server')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('📥')
        .setDisabled(!!(info && info.players > 0))
    )

  return { embeds: [embed], components: [row] }
}

async function runUpdateProcess (interaction, app, force, isAdmin, startTime) {
  const hostIp = SSH_HOST.split('@')[1]
  const stages = [
    { name: 'Check for online players', status: 'pending' },
    { name: 'Snapshot current build', status: 'pending' },
    { name: 'Stop server if running', status: 'pending' },
    { name: 'Update via SteamCMD', status: 'pending' },
    { name: 'Start the server', status: 'pending' },
    { name: 'Verify new build', status: 'pending' }
  ]

  const refresh = async () => {
    await interaction.editReply({ embeds: [getUpdateEmbed(app, stages)], components: [] })
  }

  try {
    // Stage 0: Check for online players
    stages[0].status = 'running'
    await refresh()

    if (app.queryPort) {
      const info = await getServerInfo(hostIp, app.queryPort)
      const playerCount = info ? info.players : 0

      if (playerCount > 0 && !force) {
        stages[0].status = 'failed'
        const abortMsg = `⚠️ **Abort**: There are currently **${playerCount}** player(s) online.\n` +
                                (isAdmin ? 'Use `force: true` to override.' : 'Empty server required for non-admins.')
        return interaction.editReply({ embeds: [getUpdateEmbed(app, stages, abortMsg)] })
      }
    }
    stages[0].status = 'done'

    // Stage 1: Snapshot current build
    stages[1].status = 'running'
    await refresh()
    const oldBuild = await getBuildID(app)
    stages[1].status = 'done'

    // Stage 2: Stop server if running
    stages[2].status = 'running'
    await refresh()
    const taskList = await runSSH('tasklist /FO CSV')
    const isRunning = taskList.includes(app.processName)

    if (isRunning) {
      await runSSH(`taskkill /F /IM ${app.processName} /T`)
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    stages[2].status = 'done'

    // Stage 3: Update via SteamCMD
    stages[3].status = 'running'
    await refresh()
    let updateOutput
    try {
      updateOutput = await runSSH(
                `${STEAMCMD} +force_install_dir "${app.installDir}" +login anonymous +app_update ${app.appId} validate +quit`
      )
    } catch (steamErr) {
      if (steamErr.stdout && steamErr.stdout.includes(`Success! App '${app.appId}' fully installed.`)) {
        updateOutput = steamErr.stdout
      } else {
        throw steamErr
      }
    }

    if (!updateOutput.includes(`Success! App '${app.appId}'`)) {
      throw new Error('SteamCMD did not report success.')
    }
    stages[3].status = 'done'

    // Stage 4: Start the server
    stages[4].status = 'running'
    await refresh()
    await runSSH(`wmic process call create "${app.installDir}\\${app.executable}", "${app.installDir}"`)
    stages[4].status = 'done'

    // Stage 5: Verify new build
    stages[5].status = 'running'
    await refresh()
    const newBuild = await getBuildID(app)
    stages[5].status = 'done'

    const elapsed = formatElapsed(startTime)
    let finalMsg
    if (oldBuild && newBuild && oldBuild === newBuild) {
      finalMsg = `✅ **Server is already up to date!** (Build: \`${newBuild}\`)\nElapsed: ${elapsed}`
    } else {
      finalMsg = `✅ **Update successful!**\nBuild: \`${oldBuild || '?'}\` ➡️ \`${newBuild || '?'}\`\nElapsed: ${elapsed}`
    }

    await interaction.editReply({ embeds: [getUpdateEmbed(app, stages, null, finalMsg)], components: [] })

    // Auto-transition back to status after 10 seconds
    setTimeout(async () => {
      try {
        const updatedPayload = await fetchStatusPayload(app)
        await interaction.editReply(updatedPayload)
      } catch (transitionErr) {
        logger.warn(`Auto-transition back to status failed for ${app.name}: ${transitionErr.message}`)
      }
    }, 30000)
  } catch (err) {
    logger.error(`${app.name} update error: ${err.message}`)
    const current = stages.find(s => s.status === 'running')
    if (current) current.status = 'failed'
    return interaction.editReply({ embeds: [getUpdateEmbed(app, stages, err.message)], components: [] })
  }
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
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('update')
        .setDescription('Update and restart a server')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('The server to update')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addBooleanOption(opt =>
          opt.setName('force')
            .setDescription('Force restart even if players are online')
            .setRequired(false)
        )
    ),

  async autocomplete (interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase()

    // Filter by guild restriction first, then by user input
    const filtered = steamApps.filter(app => {
      const matchesGuild = !app.guildId || interaction.guildId === app.guildId
      const matchesInput = app.name.toLowerCase().includes(focusedValue) ||
                                 app.key.toLowerCase().includes(focusedValue)
      return matchesGuild && matchesInput
    })

    await interaction.respond(
      filtered.map(app => ({ name: app.name, value: app.key })).slice(0, 25)
    )
  },

  async handleButton (interaction) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator)

    if (interaction.customId.startsWith('server_refresh_')) {
      const key = interaction.customId.replace('server_refresh_', '')
      const app = steamApps.find(a => a.key === key)
      if (!app) return interaction.reply({ content: 'Server not found.', ephemeral: true })

      // 1. Immediately disable buttons and show loading state
      const firstEmbed = interaction.message.embeds[0]
      const currentEmbed = firstEmbed ? EmbedBuilder.from(firstEmbed) : new EmbedBuilder().setTitle('Server Status').setColor('#3498db')
      currentEmbed.setFooter({ text: 'Refreshing status... please wait.' })

      const disabledRow = new ActionRowBuilder()
        .addComponents(
          ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
          ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
        )

      await interaction.update({ embeds: [currentEmbed], components: [disabledRow] })

      try {
        const payload = await fetchStatusPayload(app)
        await interaction.editReply(payload)
      } catch (err) {
        logger.error(`Refresh error: ${err.message}`)
        const errorEmbed = EmbedBuilder.from(currentEmbed).setFooter({ text: `Failed to refresh: ${err.message}` })
        const enabledRow = new ActionRowBuilder()
          .addComponents(
            ButtonBuilder.from(disabledRow.components[0]).setDisabled(false),
            ButtonBuilder.from(disabledRow.components[1]).setDisabled(false)
          )
        await interaction.editReply({ embeds: [errorEmbed], components: [enabledRow] })
      }
    }

    if (interaction.customId.startsWith('server_update_')) {
      const key = interaction.customId.replace('server_update_', '')
      const app = steamApps.find(a => a.key === key)
      if (!app) return interaction.reply({ content: 'Server not found.', ephemeral: true })

      await interaction.deferUpdate()
      await runUpdateProcess(interaction, app, false, isAdmin, Date.now())
    }
  },

  async execute (interaction) {
    await interaction.deferReply()
    const startTime = Date.now()
    const sub = interaction.options.getSubcommand()
    const name = interaction.options.getString('name')
    const app = steamApps.find(a => a.key === name)

    if (!app) {
      return interaction.editReply(`❌ Error: Application definition for \`${name}\` not found.`)
    }

    // Guild restriction
    if (app.guildId && interaction.guildId !== app.guildId) {
      return interaction.editReply(`❌ Error: This server is not authorized to manage the **${app.name}** game server.`)
    }

    // --- SUBCOMMAND: STATUS ---
    if (sub === 'status') {
      try {
        const payload = await fetchStatusPayload(app)
        return interaction.editReply(payload)
      } catch (err) {
        logger.error(`Status error: ${err.message}`)
        return interaction.editReply(`❌ Error retrieving status: ${err.message}`)
      }
    }

    // --- SUBCOMMAND: UPDATE ---
    if (sub === 'update') {
      const force = interaction.options.getBoolean('force') || false
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator)

      if (force && !isAdmin) {
        return interaction.editReply('❌ Error: Only administrators can use the `force` option.')
      }

      return runUpdateProcess(interaction, app, force, isAdmin, startTime)
    }
  }
}
