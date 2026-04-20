const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const logger = require('../logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Manage Skynet settings for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true) // Allow in DMs for owner
        .addSubcommand(sub =>
            sub.setName('agent')
               .setDescription('Toggle proactive autonomous agent suggestions')
               .addBooleanOption(opt =>
                    opt.setName('enabled')
                       .setDescription('Whether the agent can chime in proactively')
                       .setRequired(true)
                )
               .addStringOption(opt =>
                    opt.setName('server_id')
                       .setDescription('Target Server ID (Owner Only)')
                       .setRequired(false)
                )
        ),

    async execute(interaction, database) {
        if (!database) return interaction.reply({ content: 'Database connection is unavailable.', ephemeral: true });

        const sub = interaction.options.getSubcommand();
        const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
        const isOwner = interaction.user.id === process.env.OWNER_ID;

        if (!isAdmin && !isOwner) {
            return interaction.reply({ content: 'You do not have permission to manage bot configuration.', ephemeral: true });
        }

        const targetGuildId = interaction.options.getString('server_id') || interaction.guildId;
        
        if (!targetGuildId) {
            return interaction.reply({ content: 'Please provide a Server ID when using this command in DMs.', ephemeral: true });
        }

        if (sub === 'agent') {
            const enabled = interaction.options.getBoolean('enabled');
            const ref = database.ref(`guild_settings/${targetGuildId}/agent_enabled`);

            try {
                await ref.set(enabled);
                
                const embed = new EmbedBuilder()
                    .setTitle('Skynet Configuration Updated')
                    .setDescription(`Proactive Agent Suggestions are now **${enabled ? 'ENABLED' : 'DISABLED'}** for server \`${targetGuildId}\`.`)
                    .setColor(enabled ? 0x00FF00 : 0xFF0000)
                    .setTimestamp();

                if (enabled) {
                    embed.addFields({ 
                        name: 'What this means', 
                        value: 'Skynet will occasionally analyze recent messages and chime in with suggestions if it finds a high-impact way to help, without needing a direct mention.'
                    });
                }

                return interaction.reply({ embeds: [embed] });
            } catch (err) {
                logger.error(`Failed to update config for ${guildId}: ${err.message}`);
                return interaction.reply({ content: 'Failed to update configuration in the database.', ephemeral: true });
            }
        }
    },
};
