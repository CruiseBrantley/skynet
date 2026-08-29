const { ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require('discord.js')
const logger = require('../logger')

const SOUNDS = [
  { id: 'block', label: 'Block', icon: '🛡️' },
  { id: 'attack', label: 'Attack', icon: '⚔️' },
  { id: 'crit', label: 'Crit', icon: '💥' },
  { id: 'poison', label: 'Poison', icon: '☠️' },
  { id: 'burn', label: 'Burn', icon: '🔥' },
  { id: 'heal', label: 'Heal', icon: '💚' },
  { id: 'win', label: 'Victory', icon: '🏆' },
  { id: 'lose', label: 'Defeat', icon: '💀' },
  { id: 'coin', label: 'Coin', icon: '🪙' },
  { id: 'click', label: 'Click', icon: '🖱️' },
  { id: 'whoosh', label: 'Whoosh', icon: '💨' },
  { id: 'explosion', label: 'Explosion', icon: '💣' }
]

const SR = 48000

function noise () { return Math.random() * 2 - 1 }

function adsr (t, dur, a, d, s, r) {
  if (t < a) return t / a
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d)
  if (t < dur - r) return s
  return s * Math.max(0, (dur - t) / r)
}

function synth (id) {
  let dur, samples
  switch (id) {
    case 'block': {
      dur = 0.35
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.exp(-t * 18)
        const impact = t < 0.008 ? noise() * 0.9 : 0
        const metal = Math.sin(2 * Math.PI * 220 * t) * 0.4 + Math.sin(2 * Math.PI * 587 * t) * 0.25 + Math.sin(2 * Math.PI * 1247 * t) * 0.15 + Math.sin(2 * Math.PI * 2103 * t) * 0.08
        const thud = Math.sin(2 * Math.PI * 80 * t) * 0.5
        const v = Math.max(-1, Math.min(1, (metal + thud + impact) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'attack': {
      dur = 0.3
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.exp(-t * 12)
        const sweep = Math.sin(2 * Math.PI * (300 + t * 2000) * t) * 0.3
        const impact = t > 0.08 && t < 0.12 ? noise() * 0.7 : 0
        const thud = t > 0.08 ? Math.sin(2 * Math.PI * 120 * t) * 0.4 * Math.exp(-(t - 0.08) * 20) : 0
        const v = Math.max(-1, Math.min(1, (sweep + impact + thud) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'crit': {
      dur = 0.5
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.exp(-t * 6)
        const bell = Math.sin(2 * Math.PI * 880 * t) * 0.35 + Math.sin(2 * Math.PI * 2429 * t) * 0.2 + Math.sin(2 * Math.PI * 4858 * t) * 0.1
        const strike = t < 0.005 ? noise() * 0.8 : 0
        const shimmer = Math.sin(2 * Math.PI * 1760 * t) * 0.15 * Math.sin(2 * Math.PI * 8 * t)
        const v = Math.max(-1, Math.min(1, (bell + strike + shimmer) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'poison': {
      dur = 0.6
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.sin(Math.PI * t / dur)
        const bubble = Math.sin(2 * Math.PI * (120 + 60 * Math.sin(2 * Math.PI * 7 * t)) * t) * 0.4
        const gurgle = Math.sin(2 * Math.PI * (200 + 100 * Math.sin(2 * Math.PI * 11 * t + 1)) * t) * 0.2
        const blip = (Math.sin(2 * Math.PI * 40 * t) > 0.7) ? noise() * 0.3 : 0
        const v = Math.max(-1, Math.min(1, (bubble + gurgle + blip) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'burn': {
      dur = 0.5
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.sin(Math.PI * t / dur)
        const crackle = noise() * 0.3 * (Math.sin(2 * Math.PI * 30 * t) > 0 ? 1 : 0.3)
        const rumble = Math.sin(2 * Math.PI * 60 * t) * 0.2 + Math.sin(2 * Math.PI * 90 * t) * 0.1
        const hiss = noise() * 0.15
        const v = Math.max(-1, Math.min(1, (crackle + rumble + hiss) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'heal': {
      dur = 0.7
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = adsr(t, dur, 0.05, 0.15, 0.6, 0.2)
        const c5 = Math.sin(2 * Math.PI * 523.25 * t) * 0.25
        const e5 = Math.sin(2 * Math.PI * 659.25 * t) * 0.2
        const g5 = Math.sin(2 * Math.PI * 783.99 * t) * 0.15
        const c6 = Math.sin(2 * Math.PI * 1046.5 * t) * 0.08
        const v = Math.max(-1, Math.min(1, (c5 + e5 + g5 + c6) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'win': {
      dur = 0.9
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      const notes = [523.25, 659.25, 783.99, 1046.5]
      const segDur = dur / notes.length
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const seg = Math.min(Math.floor(t / segDur), notes.length - 1)
        const tSeg = t - seg * segDur
        const env = Math.exp(-tSeg * 5) * Math.min(1, tSeg / 0.02)
        const f = notes[seg]
        const tone = Math.sin(2 * Math.PI * f * t) * 0.3 + Math.sin(2 * Math.PI * f * 2 * t) * 0.1
        const v = Math.max(-1, Math.min(1, tone * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'lose': {
      dur = 0.9
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      const notes = [440, 349.23, 293.66, 220]
      const segDur = dur / notes.length
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const seg = Math.min(Math.floor(t / segDur), notes.length - 1)
        const tSeg = t - seg * segDur
        const env = Math.exp(-tSeg * 4) * Math.min(1, tSeg / 0.03)
        const f = notes[seg]
        const tone = Math.sin(2 * Math.PI * f * t) * 0.3 + Math.sin(2 * Math.PI * f * 0.5 * t) * 0.15
        const v = Math.max(-1, Math.min(1, tone * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'coin': {
      dur = 0.25
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.exp(-t * 25)
        const ping1 = Math.sin(2 * Math.PI * 2500 * t) * 0.3 + Math.sin(2 * Math.PI * 6875 * t) * 0.1
        const ping2 = t > 0.06 ? Math.sin(2 * Math.PI * 3200 * (t - 0.06)) * 0.25 * Math.exp(-(t - 0.06) * 20) : 0
        const strike = t < 0.003 ? noise() * 0.6 : 0
        const v = Math.max(-1, Math.min(1, (ping1 + ping2 + strike) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'click': {
      dur = 0.04
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.exp(-t * 120)
        const tick = Math.sin(2 * Math.PI * 4000 * t) * 0.4 + noise() * 0.3
        const v = Math.max(-1, Math.min(1, tick * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'whoosh': {
      dur = 0.35
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.sin(Math.PI * t / dur)
        const sweep = noise() * 0.4
        const tone = Math.sin(2 * Math.PI * (200 + t * 1500) * t) * 0.15
        const v = Math.max(-1, Math.min(1, (sweep + tone) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    case 'explosion': {
      dur = 0.6
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const env = Math.exp(-t * 8)
        const boom = Math.sin(2 * Math.PI * (60 + t * 40) * t) * 0.6
        const crack = t < 0.02 ? noise() * 0.9 : noise() * 0.2
        const rumble = Math.sin(2 * Math.PI * 40 * t) * 0.3
        const v = Math.max(-1, Math.min(1, (boom + crack + rumble) * env))
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
    default: {
      dur = 0.2
      samples = Math.floor(SR * dur)
      const buf = Buffer.alloc(samples * 2)
      for (let i = 0; i < samples; i++) {
        const t = i / SR
        const v = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t * 15) * 0.5
        buf.writeInt16LE(Math.round(v * 32767), i * 2)
      }
      return buf
    }
  }
}

async function playSound (interaction, soundId) {
  const guild = interaction.guild
  if (!guild) {
    await interaction.reply({ content: 'Must be used in a server.', flags: [64] })
    return
  }

  const member = interaction.member
  if (!member || !member.voice || !member.voice.channel) {
    await interaction.reply({ content: 'Join a voice channel first.', flags: [64] })
    return
  }

  const vc = member.voice.channel

  try {
    const {
      getVoiceConnection,
      joinVoiceChannel,
      createAudioPlayer,
      createAudioResource,
      AudioResource,
      VoiceConnectionStatus
    } = require('@discordjs/voice')

    let connection = getVoiceConnection(guild.id)

    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true
      })

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Voice connection timeout')), 10000)
        if (connection.state.status === VoiceConnectionStatus.Ready) {
          clearTimeout(timeout)
          resolve()
        } else {
          connection.on(VoiceConnectionStatus.Ready, () => { clearTimeout(timeout); resolve() })
        }
        connection.on('error', (e) => { clearTimeout(timeout); reject(e) })
      })
    }

    const pcm = synth(soundId)
    const player = createAudioPlayer()
    const resource = createAudioResource(pcm, { inputType: AudioResource.Type.Raw, inlineVolume: true })
    resource.volume.setVolume(1.0)

    const subscription = connection.subscribe(player)
    player.play(resource)

    const label = SOUNDS.find(s => s.id === soundId)
    await interaction.reply({ content: (label ? label.icon + ' ' + label.label : soundId) + ' — playing', flags: [64] })

    player.on('stateChange', (oldState, newState) => {
      if (newState.status === 'idle') {
        subscription.unsubscribe()
        setTimeout(() => {
          if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
            connection.destroy()
          }
        }, 2000)
      }
    })
  } catch (err) {
    logger.error('Soundboard playback error:', err)
    await interaction.reply({ content: 'Voice playback failed: ' + err.message, flags: [64] })
  }
}

module.exports = {
  data: {
    name: 'soundboard',
    description: 'Play a card battler themed sound in your voice channel',
    options: []
  },
  execute: async (interaction) => {
    const rows = []
    for (let i = 0; i < SOUNDS.length; i += 5) {
      const buttons = SOUNDS.slice(i, i + 5).map(s =>
        new ButtonBuilder().setCustomId('sb_' + s.id).setLabel(s.icon + ' ' + s.label).setStyle(4)
      )
      rows.push(new ActionRowBuilder().addComponents(buttons))
    }
    const embed = new EmbedBuilder()
      .setTitle('⚔️ Card Battler Soundboard')
      .setDescription('Click a sound to play it in your voice channel.\nYou must be connected to a voice channel.')
      .setColor(0x9b59b6)
      .setFooter({ text: 'Slay the Spire 2 table audio' })
    await interaction.reply({ embeds: [embed], components: rows })
  },
  buttonHandler: async (interaction) => {
    const soundId = interaction.customId.replace('sb_', '')
    await playSound(interaction, soundId)
  }
}
