const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../config/announcements.json');

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
