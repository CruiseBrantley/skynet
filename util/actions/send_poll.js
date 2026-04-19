const { MessageFlags } = require('discord.js');
const logger = require('../../logger');

module.exports = {
    name: 'send_poll',
    description: 'Creates a Discord native poll in a channel with a question, options, and duration',
    schema: {
        question: 'string — the poll question',
        options: 'string[] — array of 2-10 logical answer choices. BRAINSTORM these if the user is vague.',
        duration_hours: 'number — Discord ONLY supports 1, 4, 8, 24, 72, or 168 hours. Pick the closest one.',
        allow_multiselect: 'boolean — whether users can pick multiple answers (default: false)',
        channel: 'string — target channel mention or ID if specified (e.g. #bot-commands)'
    },
    execute: async (bot, channel, params, interaction) => {
        let options = params.options || params.choices || ['Yes', 'No'];
        if (!Array.isArray(options)) options = ['Yes', 'No'];

        // Filter out empty or whitespace-only options and ensure text is non-empty
        let validOptions = options
            .map(opt => String(opt).trim())
            .filter(opt => opt.length > 0)
            .slice(0, 10);

        // Discord requires at least 2 answers
        if (validOptions.length < 2) {
            validOptions = ['Yes', 'No'];
        }

        const rawDuration = params.duration_hours != null ? parseInt(params.duration_hours) : 24;
        
        // Discord supports exactly these durations (in hours)
        const supported = [1, 4, 8, 24, 72, 168];
        const duration = supported.reduce((prev, curr) => 
            Math.abs(curr - rawDuration) < Math.abs(prev - rawDuration) ? curr : prev
        );

        const questionText = (params.question || params.content || 'Poll').trim().substring(0, 300) || 'Poll';
        const payload = {
            poll: {
                question: { text: questionText },
                answers: validOptions.map(opt => ({
                    poll_media: { text: opt.substring(0, 55) }
                })),
                duration,
                allow_multiselect: !!params.allow_multiselect,
                layout_type: 1
            }
        };

        logger.info(`ActionExecutor: Sending poll to ${channel.id}: ${JSON.stringify(payload)}`);
        await channel.send(payload);
    }
};
