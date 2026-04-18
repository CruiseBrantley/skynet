module.exports = {
    name: 'send_thread',
    description: 'Creates a new public thread in a channel with a name and an opening message',
    schema: {
        thread_name: 'string — the display name of the thread (max 100 chars)',
        content: 'string — the opening message posted inside the thread',
        auto_archive_hours: 'number — hours until thread auto-archives: 1, 24, 72, or 168 (default: 24)'
    },
    execute: async (bot, channel, params) => {
        if (!channel.threads) {
            throw new Error(`Channel ${channel.id} does not support threads.`);
        }

        const VALID_DURATIONS = [60, 1440, 4320, 10080];
        const requestedHours = parseInt(params.auto_archive_hours || 24);
        const durationMinutes = VALID_DURATIONS.reduce((prev, curr) =>
            Math.abs(curr - requestedHours * 60) < Math.abs(prev - requestedHours * 60) ? curr : prev
        );

        const thread = await channel.threads.create({
            name: (params.thread_name || 'New Thread').substring(0, 100),
            autoArchiveDuration: durationMinutes,
            reason: 'Created by Skynet scheduler'
        });

        await thread.send({
            content: params.content || params.message || ''
        });
    }
};
