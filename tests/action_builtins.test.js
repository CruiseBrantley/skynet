/**
 * Tests for built-in Discord action modules.
 * Each action is tested in isolation with a mocked Discord channel.
 */

describe('Built-in Actions', () => {
    let mockChannel;

    beforeEach(() => {
        mockChannel = { send: jest.fn().mockResolvedValue({ id: 'msg_1' }) };
    });

    // ─── send_message ──────────────────────────────────────────────────────────

    describe('send_message', () => {
        const action = require('../util/actions/send_message');

        test('sends content field to channel', async () => {
            await action.execute(null, mockChannel, { content: 'Hello world!' });
            expect(mockChannel.send).toHaveBeenCalledWith({ content: 'Hello world!' });
        });

        test('falls back to message field when content is absent', async () => {
            await action.execute(null, mockChannel, { message: 'Fallback text' });
            expect(mockChannel.send).toHaveBeenCalledWith({ content: 'Fallback text' });
        });

        test('sends empty string when no content or message', async () => {
            await action.execute(null, mockChannel, {});
            expect(mockChannel.send).toHaveBeenCalledWith({ content: '' });
        });
    });

    // ─── send_poll ────────────────────────────────────────────────────────────

    describe('send_poll', () => {
        const action = require('../util/actions/send_poll');

        const basicPoll = async (params) => {
            await action.execute(null, mockChannel, params);
            return mockChannel.send.mock.calls[0][0].poll;
        };

        test('sends poll with correct question text', async () => {
            const poll = await basicPoll({ question: 'Who is coming?', options: ['Yes', 'No'] });
            expect(poll.question.text).toBe('Who is coming?');
        });

        test('maps options to poll_media answer format', async () => {
            const poll = await basicPoll({ question: 'Q?', options: ['Alpha', 'Beta', 'Gamma'] });
            expect(poll.answers).toHaveLength(3);
            expect(poll.answers[0].text).toBe('Alpha');
            expect(poll.answers[2].text).toBe('Gamma');
        });

        test('accepts choices field as alias for options', async () => {
            const poll = await basicPoll({ question: 'Q?', choices: ['A', 'B'] });
            expect(poll.answers[0].text).toBe('A');
        });

        test('defaults to Yes/No when no options provided', async () => {
            const poll = await basicPoll({ question: 'Here?' });
            expect(poll.answers[0].text).toBe('Yes');
            expect(poll.answers[1].text).toBe('No');
        });

        test('uses duration_hours from params', async () => {
            const poll = await basicPoll({ question: 'Q?', options: ['A', 'B'], duration_hours: 24 });
            expect(poll.duration).toBe(24);
        });

        test('clamps duration to minimum of 1', async () => {
            const poll = await basicPoll({ question: 'Q?', options: ['A', 'B'], duration_hours: 0 });
            expect(poll.duration).toBe(1);
        });

        test('clamps duration to maximum of 168 (1 week)', async () => {
            const poll = await basicPoll({ question: 'Q?', options: ['A', 'B'], duration_hours: 9999 });
            expect(poll.duration).toBe(168);
        });

        test('truncates to max 10 options', async () => {
            const opts = Array.from({ length: 15 }, (_, i) => `Option ${i + 1}`);
            const poll = await basicPoll({ question: 'Q?', options: opts });
            expect(poll.answers).toHaveLength(10);
        });

        test('defaults allow_multiselect to false', async () => {
            const poll = await basicPoll({ question: 'Q?', options: ['A', 'B'] });
            expect(poll.allow_multiselect).toBe(false);
        });

        test('respects allow_multiselect: true', async () => {
            const poll = await basicPoll({ question: 'Q?', options: ['A', 'B'], allow_multiselect: true });
            expect(poll.allow_multiselect).toBe(true);
        });

        test('truncates option text to 55 chars', async () => {
            const longOpt = 'A'.repeat(100);
            const poll = await basicPoll({ question: 'Q?', options: [longOpt, 'B'] });
            expect(poll.answers[0].text).toHaveLength(55);
        });
    });

    // ─── send_embed ───────────────────────────────────────────────────────────

    describe('send_embed', () => {
        // We need to mock EmbedBuilder before requiring the module
        const mockEmbed = {
            data: {},
            setTitle: jest.fn().mockImplementation(function(t) { this.data.title = t; return this; }),
            setDescription: jest.fn().mockImplementation(function(d) { this.data.description = d; return this; }),
            setColor: jest.fn().mockImplementation(function(c) { this.data.color = c; return this; }),
            setTimestamp: jest.fn().mockImplementation(function() { this.data.timestamp = new Date(); return this; }),
            setFooter: jest.fn().mockImplementation(function(f) { this.data.footer = f; return this; }),
            setThumbnail: jest.fn().mockImplementation(function(u) { this.data.thumbnail = u; return this; }),
            setImage: jest.fn().mockImplementation(function(u) { this.data.image = u; return this; }),
            addFields: jest.fn().mockImplementation(function(f) { 
                this.data.fields = [...(this.data.fields || []), ...f]; 
                return this; 
            })
        };

        beforeEach(() => {
            jest.resetModules();
            jest.mock('discord.js', () => ({
                EmbedBuilder: jest.fn().mockImplementation(() => mockEmbed)
            }));
            // Clear all spy call counts and data
            mockEmbed.data = {};
            Object.values(mockEmbed).forEach(fn => fn.mockClear?.());
        });

        const getAction = () => require('../util/actions/send_embed');

        test('calls setTitle with provided title', async () => {
            await getAction().execute(null, mockChannel, { title: 'My Title', description: 'D' });
            expect(mockEmbed.setTitle).toHaveBeenCalledWith('My Title');
        });

        test('calls setDescription with provided description', async () => {
            await getAction().execute(null, mockChannel, { title: 'T', description: 'My Body Text' });
            expect(mockEmbed.setDescription).toHaveBeenCalledWith('My Body Text');
        });

        test('uses content as description fallback', async () => {
            await getAction().execute(null, mockChannel, { title: 'T', content: 'Fallback body' });
            expect(mockEmbed.setDescription).toHaveBeenCalledWith('Fallback body');
        });

        test.each([
            ['blue',   0x5865F2],
            ['green',  0x57F287],
            ['red',    0xED4245],
            ['yellow', 0xFEE75C],
            ['orange', 0xE67E22],
        ])('maps named color "%s" to correct hex', async (colorName, hexValue) => {
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D', color: colorName });
            expect(mockEmbed.setColor).toHaveBeenCalledWith(hexValue);
        });

        test('defaults color to blue when not provided', async () => {
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D' });
            expect(mockEmbed.setColor).toHaveBeenCalledWith(0x5865F2);
        });

        test('sets footer when provided', async () => {
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D', footer: 'My Footer' });
            expect(mockEmbed.setFooter).toHaveBeenCalledWith({ text: 'My Footer' });
        });

        test('does not call setFooter when footer is absent', async () => {
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D' });
            expect(mockEmbed.setFooter).not.toHaveBeenCalled();
        });

        test('adds fields with correct structure', async () => {
            const fields = [
                { name: 'Field 1', value: 'Value 1', inline: true },
                { name: 'Field 2', value: 'Value 2', inline: false }
            ];
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D', fields });
            expect(mockEmbed.addFields).toHaveBeenCalledWith([
                { name: 'Field 1', value: 'Value 1', inline: true },
                { name: 'Field 2', value: 'Value 2', inline: false }
            ]);
        });

        test('limits fields to 25 max', async () => {
            const fields = Array.from({ length: 30 }, (_, i) => ({ name: `F${i}`, value: `V${i}` }));
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D', fields });
            const addedFields = mockEmbed.addFields.mock.calls[0][0];
            expect(addedFields).toHaveLength(25);
        });

        test('sets thumbnail URL when provided', async () => {
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D', thumbnail: 'https://img.png' });
            expect(mockEmbed.setThumbnail).toHaveBeenCalledWith('https://img.png');
        });

        test('sets image URL when provided', async () => {
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D', image: 'https://img.jpg' });
            expect(mockEmbed.setImage).toHaveBeenCalledWith('https://img.jpg');
        });

        test('sends the embed to channel', async () => {
            await getAction().execute(null, mockChannel, { title: 'T', description: 'D' });
            expect(mockChannel.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
        });
    });

    // ─── send_thread ──────────────────────────────────────────────────────────

    describe('send_thread', () => {
        const action = require('../util/actions/send_thread');

        let mockThread;
        let threadChannel;

        beforeEach(() => {
            mockThread = { id: 'thread_1', send: jest.fn().mockResolvedValue({}) };
            threadChannel = {
                threads: { create: jest.fn().mockResolvedValue(mockThread) },
                send: jest.fn()
            };
        });

        test('creates a thread with the given name', async () => {
            await action.execute(null, threadChannel, { thread_name: 'My Discussion', content: 'Welcome!' });
            expect(threadChannel.threads.create).toHaveBeenCalledWith(expect.objectContaining({
                name: 'My Discussion'
            }));
        });

        test('sends opening message into the thread', async () => {
            await action.execute(null, threadChannel, { thread_name: 'T', content: 'Hello thread!' });
            expect(mockThread.send).toHaveBeenCalledWith({ content: 'Hello thread!' });
        });

        test('truncates thread name to 100 chars', async () => {
            const longName = 'A'.repeat(200);
            await action.execute(null, threadChannel, { thread_name: longName, content: 'Hi' });
            const callArgs = threadChannel.threads.create.mock.calls[0][0];
            expect(callArgs.name.length).toBeLessThanOrEqual(100);
        });

        test('uses default thread name when not provided', async () => {
            await action.execute(null, threadChannel, { content: 'Hello' });
            const callArgs = threadChannel.threads.create.mock.calls[0][0];
            expect(callArgs.name).toBe('New Thread');
        });

        test('falls back to message field for opening content', async () => {
            await action.execute(null, threadChannel, { thread_name: 'T', message: 'Fallback msg' });
            expect(mockThread.send).toHaveBeenCalledWith({ content: 'Fallback msg' });
        });

        test('picks closest valid auto-archive duration', async () => {
            // Requesting 2 hours should map to 24h (1440 min) since 60min gap < 1380min gap
            // Actually 2 hours (120 min) — closest of [60, 1440, 4320, 10080] is 60
            await action.execute(null, threadChannel, { thread_name: 'T', content: 'Hi', auto_archive_hours: 2 });
            const callArgs = threadChannel.threads.create.mock.calls[0][0];
            expect([60, 1440, 4320, 10080]).toContain(callArgs.autoArchiveDuration);
        });

        test('throws when channel does not support threads', async () => {
            await expect(action.execute(null, mockChannel, { thread_name: 'T', content: 'C' }))
                .rejects.toThrow(/does not support threads/);
        });
    });

    // ─── add_reaction ─────────────────────────────────────────────────────────

    describe('add_reaction', () => {
        const action = require('../util/actions/add_reaction');
        
        test('adds emoji to specified message', async () => {
            const mockMessage = { react: jest.fn().mockResolvedValue() };
            const mChannel = { messages: { fetch: jest.fn().mockResolvedValue(mockMessage) } };
            await action.execute(null, mChannel, { messageId: '123', emoji: '👍' });
            expect(mChannel.messages.fetch).toHaveBeenCalledWith('123');
            expect(mockMessage.react).toHaveBeenCalledWith('👍');
        });
    });

    // ─── remove_reaction ──────────────────────────────────────────────────────

    describe('remove_reaction', () => {
        const action = require('../util/actions/remove_reaction');
        
        test('removes bot reaction from specified message', async () => {
            const mockUsersRemove = jest.fn().mockResolvedValue();
            const mockReaction = { 
                emoji: { name: '👍' }, 
                users: { remove: mockUsersRemove } 
            };
            const mockMessage = { 
                reactions: { cache: [mockReaction] } // Array supports .find()
            };
            const mChannel = { messages: { fetch: jest.fn().mockResolvedValue(mockMessage) } };
            const mockBot = { user: { id: 'bot123' } };
            
            await action.execute(mockBot, mChannel, { messageId: '123', emoji: '👍' });
            expect(mockUsersRemove).toHaveBeenCalledWith('bot123');
        });
    });

    // ─── summarize_history ────────────────────────────────────────────────────

    describe('summarize_history', () => {
        let action;
        let mockOllama;
        
        beforeEach(() => {
            jest.resetModules();
            jest.mock('discord.js', () => ({
                EmbedBuilder: jest.fn().mockImplementation(function() {
                    this.setTitle = jest.fn().mockReturnThis();
                    this.setDescription = jest.fn().mockReturnThis();
                    this.setColor = jest.fn().mockReturnThis();
                    this.setFooter = jest.fn().mockReturnThis();
                })
            }));
            jest.mock('../util/ollama', () => ({
                queryOllama: jest.fn().mockResolvedValue({ message: { content: 'Summary text' } })
            }));
            action = require('../util/actions/summarize_history');
            mockOllama = require('../util/ollama').queryOllama;
        });

        test('fetches messages, calls ollama, and replies with embed', async () => {
            const mockMessages = [
                { author: { username: 'Alice' }, content: 'Hi' },
                { author: { username: 'Bob' }, content: 'Hello' }
            ];
            // Mock the collection's reverse method
            mockMessages.reverse = () => mockMessages;
            
            const mChannel = { id: 'ch1', messages: { fetch: jest.fn().mockResolvedValue(mockMessages) } };
            const mContext = { editReply: jest.fn().mockResolvedValue() };
            
            await action.execute(null, mChannel, { count: 5 }, mContext);
            
            expect(mChannel.messages.fetch).toHaveBeenCalledWith({ limit: 5 });
            expect(mockOllama).toHaveBeenCalled();
            expect(mContext.editReply).toHaveBeenCalled();
        });
    });
});
