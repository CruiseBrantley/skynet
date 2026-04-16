const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../config/announcements.json');

const recentAnnouncements = new Map(); // broadcaster_id -> timestamp
const ANNOUNCE_COOLDOWN = 30 * 60 * 1000; // 30 minutes

function loadConfig() {
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    logger.error('Error loading announcement config:', err);
    return { groups: [], socials: {} };
  }
}

async function announce(bot, data, group, config) {
  try {
    const attachment = new AttachmentBuilder('image.jpg', { name: 'image.jpg' });
    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${data.broadcaster_name} is Streaming ${data.game_name ? `${data.game_name} ` : ''}on Twitch!`
      })
      .setURL(`https://www.twitch.tv/${data.broadcaster_name}`)
      .setTitle(data.title)
      .setImage('attachment://image.jpg')
      .setTimestamp();

    const socials = config.socials[data.broadcaster_id];
    const youtubeText = socials && socials.youtube ? `\n📺 **YouTube:** ${socials.youtube}` : '';

    const targetChannel = await bot.channels.fetch(group.channel_id);
    if (!targetChannel) {
      logger.info(`botAnnounce: Channel ${group.channel_id} not found`);
      return;
    }

    const mention = group.mention !== undefined ? group.mention : '@everyone';

    await targetChannel.send({
      content: `${mention} ${data.broadcaster_name} has gone Live! https://www.twitch.tv/${data.broadcaster_name}${youtubeText}`,
      embeds: [embed],
      files: [attachment]
    });
  } catch (err) {
    logger.error('Main announce error:', err);
  }
}

async function botAnnounce(bot, data) {
  try {
    // 2. Session Deduplication (Online/Offline flicker)
    const now = Date.now();
    const lastAnnounce = recentAnnouncements.get(data.broadcaster_id);
    if (lastAnnounce && (now - lastAnnounce < ANNOUNCE_COOLDOWN)) {
      logger.info(`botAnnounce: Skipping duplicate announcement for ${data.broadcaster_name} (Cooldown active)`);
      return;
    }
    recentAnnouncements.set(data.broadcaster_id, now);
    // Prune stale entries from recentAnnouncements to keep memory low
    if (recentAnnouncements.size > 100) {
        for (const [id, ts] of recentAnnouncements) {
            if (now - ts > ANNOUNCE_COOLDOWN * 2) recentAnnouncements.delete(id);
        }
    }

    const config = loadConfig();
    const imageUrl = data.game_image
      ? data.game_image.replace('{width}', '900').replace('{height}', '1200')
      : data.thumbnail_url
        .replace('{width}', '1025')
        .replace('{height}', '577');

    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync('image.jpg', imageResponse.data);

    for (const group of config.groups) {
      if (group.streamers.includes(data.broadcaster_id)) {
        logger.info(`Announcing: ${data.broadcaster_name} in ${group.channel_id}`);
        await announce(bot, data, group, config);
      }
    }
  } catch (err) {
    logger.error('Error in botAnnounce:', err);
  }
}

module.exports = botAnnounce;
