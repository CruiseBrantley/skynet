jest.mock('child_process');
jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

const { execFile } = require('child_process');
const updateServer = require('../commands/update-server');

// ── Helpers ──

function mockInteraction(appKey = 'icarus') {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        channel: { send: jest.fn().mockResolvedValue() },
        options: {
            getString: jest.fn().mockReturnValue(appKey)
        }
    };
}

/**
 * Set up execFile to respond to SSH calls in sequence.
 */
function stubSSH(stubs) {
    let callIndex = 0;
    execFile.mockImplementation((bin, args, opts, cb) => {
        const command = args[args.length - 1]; // last arg is the remote command
        const stub = stubs[callIndex++];

        if (!stub) {
            return cb(new Error(`Unexpected SSH call #${callIndex}: ${command}`), '', '');
        }

        if (stub.match && !command.includes(stub.match)) {
            return cb(
                new Error(`SSH call #${callIndex} expected "${stub.match}" but got "${command}"`),
                '', ''
            );
        }

        const stdout = stub.stdout || '';
        const stderr = stub.stderr || '';

        if (stub.exitCode) {
            const err = new Error(`Command failed with exit code ${stub.exitCode}`);
            err.code = stub.exitCode;
            err.stdout = stdout;
            err.stderr = stderr;
            return cb(err, stdout, stderr);
        }

        cb(null, stdout, stderr);
    });
}

// ── Tests ──

describe('update-server', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('formatElapsed', () => {
        test('formats seconds only', () => {
            const base = Date.now() - 45_000;
            expect(updateServer._formatElapsed(base)).toBe('45s');
        });
    });

    describe('command metadata', () => {
        test('exports valid slash command data', () => {
            expect(updateServer.data.name).toBe('update-server');
            expect(updateServer.data.description).toBeTruthy();
        });

        test('loads apps from config', () => {
            expect(updateServer._steamApps).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: 'icarus', appId: '2089300' })
                ])
            );
        });
    });

    describe('execute — happy path', () => {
        test('full update cycle for Icarus', async () => {
            jest.useFakeTimers();
            const interaction = mockInteraction('icarus');

            stubSSH([
                // Stage 1: getBuildID — pre-update
                { match: 'app_status', stdout: 'BuildID 22000000' },
                // Stage 2: tasklist
                { match: 'tasklist', stdout: '"IcarusServer-Win64-Shipping.exe","1234"' },
                // Stage 2: taskkill
                { match: 'taskkill', stdout: 'SUCCESS' },
                // Stage 3: app_update
                { match: 'app_update', stdout: "Success! App '2089300' fully installed." },
                // Stage 4: wmic start
                { match: 'wmic', stdout: 'ReturnValue = 0' },
                // Stage 5: getBuildID — post-update
                { match: 'app_status', stdout: 'BuildID 22500000' },
            ]);

            const promise = updateServer.execute(interaction);
            await jest.advanceTimersByTimeAsync(5000);
            await promise;

            expect(interaction.deferReply).toHaveBeenCalledTimes(1);
            expect(interaction.editReply).toHaveBeenCalledTimes(7);

            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            expect(finalMsg).toContain('22000000');
            expect(finalMsg).toContain('22500000');
            expect(finalMsg).toContain('Icarus updated successfully');

            jest.useRealTimers();
        });
    });

    describe('execute — error handling', () => {
        test('reports error if app definition is missing', async () => {
            const interaction = mockInteraction('nonexistent');
            await updateServer.execute(interaction);
            expect(interaction.editReply).toHaveBeenCalledWith(
                expect.stringContaining('Application definition for `nonexistent` not found')
            );
        });

        test('surfaces "No subscription" with a clear message', async () => {
            const interaction = mockInteraction('icarus');

            stubSSH([
                { match: 'app_status', stdout: 'BuildID 22000000' },
                { match: 'tasklist', stdout: '' },
                {
                    match: 'app_update',
                    stdout: "ERROR! Failed to install app '2089300' (No subscription)",
                    exitCode: 8,
                },
            ]);

            await updateServer.execute(interaction);

            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            expect(finalMsg).toContain('❌');
            expect(finalMsg).toContain("Steam Authorization Failed: 'No subscription'");
        });
    });
});
