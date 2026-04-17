const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const googleIt = require('google-it');
const ddg = require('duck-duck-scrape');
const wiki = require('wikipedia');
wiki.setUserAgent(`${process.env.BOT_NAME || 'Bot'}/1.0`);
const logger = require('../logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the web for real-time information')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('The search query')
        .setRequired(true)),
  async execute(interaction) {
    const query = interaction.options.getString('query');
    
    // Check if we already have a status message to edit, otherwise defer
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
    }

    try {
      let results = [];
      try {
        results = await googleIt({ query: query, disableConsole: true });
      } catch (err) {
        logger.info(`Google-it failed for "${query}", trying DuckDuckGo fallback.`);
      }

      // Fallback to DuckDuckGo if Google returns no results or failed
      if (!results || results.length === 0) {
        try {
          const ddgResults = await ddg.search(query);
          if (ddgResults && ddgResults.results) {
            results = ddgResults.results.slice(0, 3).map(r => ({
              title: r.title,
              snippet: r.description,
              link: r.url
            }));
          }
        } catch (ddgErr) {
          logger.error(`DuckDuckGo fallback failed for "${query}": ${ddgErr.message}`);
        }
      }

      // Final Fallback: Wikipedia
      if (!results || results.length === 0) {
        try {
          const wikiSummary = await wiki.summary(query);
          if (wikiSummary && wikiSummary.extract) {
            results = [{
              title: wikiSummary.title,
              snippet: wikiSummary.extract,
              link: wikiSummary.content_urls.desktop.page
            }];
          }
        } catch (wikiErr) {
          logger.info(`Wikipedia fallback also failed for "${query}": ${wikiErr.message}`);
        }
      }

      if (results && results.length > 0) {
        const searchResultsStr = results.slice(0, 3).map(r => `**${r.title}**\n${r.snippet || ""}\n<${r.link}>`).join('\n\n');
        await interaction.editReply({ 
            content: `🔍 **Search Results for:** \`${query}\`\n\n${searchResultsStr}`,
            flags: [MessageFlags.SuppressEmbeds] 
        });
      } else {
        await interaction.editReply(`No reliable search results found for \`${query}\`. (Scrapers may be rate-limited).`);
      }
    } catch (err) {
      logger.error('Search command error: ' + err.message);
      await interaction.editReply('There was an error performing the search.');
    }
  },
};
