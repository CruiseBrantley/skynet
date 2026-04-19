

const { MessageFlags } = require('discord.js');
const pingCmd = require('../commands/ping');
const sayCmd = require('../commands/say');
const timeCmd = require('../commands/time');
const timestampCmd = require('../commands/timestamp');
const serverCmd = require('../commands/server');

describe('Utility Commands', () => {

    let mockInteraction;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockInteraction = {
            createdTimestamp: 1000,
            options: {
                getString: jest.fn()
            },
            member: {
                permissions: {
                    has: jest.fn()
                }
            },
            reply: jest.fn(),
            deferReply: jest.fn(),
            editReply: jest.fn()
        };
    });

    // --- Ping Command ---
    describe('/ping', () => {
        test('calculates and edits message with bot latency', async () => {
            mockInteraction.reply.mockResolvedValueOnce({ createdTimestamp: 1050 });

            await pingCmd.execute(mockInteraction);

            expect(mockInteraction.reply).toHaveBeenCalledWith({ content: 'Pinging...', fetchReply: true });
            // Latency = 1050 - 1000 = 50ms
            expect(mockInteraction.editReply).toHaveBeenCalledWith('Pong! Bot response latency is 50ms.');
        });
    });

    // --- Say Command ---
    describe('/say', () => {
        test('replies with message if user has Administrator permission', async () => {
            mockInteraction.member.permissions.has.mockReturnValue(true);
            mockInteraction.options.getString.mockReturnValue('Hello Discord');

            await sayCmd.execute(mockInteraction);

            expect(mockInteraction.reply).toHaveBeenCalledWith({ 
                content: 'Hello Discord', 
                flags: [MessageFlags.SuppressEmbeds] 
            });
        });

        test('returns ephemeral error if user lacks Administrator permission', async () => {
            mockInteraction.member.permissions.has.mockReturnValue(false);

            await sayCmd.execute(mockInteraction);

            expect(mockInteraction.reply).toHaveBeenCalledWith({ 
                content: 'You do not have permission to use this command.', 
                ephemeral: true 
            });
        });
    });

    // --- Time Command ---
    describe('/time', () => {
        const REAL_DATE = Date;
        beforeAll(() => {
            global.Date = class extends REAL_DATE {
                constructor(...args) {
                    if (args.length) return new REAL_DATE(...args);
                    return new REAL_DATE('2026-03-28T12:00:00Z');
                }
            };
        });
        afterAll(() => {
            global.Date = REAL_DATE;
        });

        test('replies with the current time explicitly', async () => {
            await timeCmd.execute(mockInteraction);
            expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
                content: expect.stringContaining('The current time is:')
            }));
        });
    });

    // --- Timestamp Command ---
    describe('/timestamp', () => {
        // Mock Date to ensure deterministic outputs for 'current time' tests
        const REAL_DATE = Date;
        beforeAll(() => {
            global.Date = class extends REAL_DATE {
                constructor(...args) {
                    if (args.length) return new REAL_DATE(...args);
                    return new REAL_DATE('2026-03-28T12:00:00Z');
                }
            };
        });
        afterAll(() => {
            global.Date = REAL_DATE;
        });

        test('formats current time if no query is provided', async () => {
            mockInteraction.options.getString.mockReturnValue(null);
            
            await timestampCmd.execute(mockInteraction);

            // 2026-03-28T12:00:00Z is 1774699200 Unix timestamp
            expect(mockInteraction.reply).toHaveBeenCalledWith(expect.stringContaining('<t:1774699200:R>'));
        });

        test('formats queried time with DST adjustment', async () => {
            mockInteraction.options.getString.mockReturnValue('2026-03-28T15:00:00Z');
            
            await timestampCmd.execute(mockInteraction);

            // 15:00:00Z is 1774710000. Less 3600 (DST logic) = 1774706400
            expect(mockInteraction.reply).toHaveBeenCalledWith(expect.stringContaining('<t:1774706400:R>'));
        });

        test('returns invalid date error for garbage strings', async () => {
            mockInteraction.options.getString.mockReturnValue('not a real date');
            
            await timestampCmd.execute(mockInteraction);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'I have no idea what date that is.',
                ephemeral: true
            });
        });
    });



});
