jest.mock('child_process');
jest.mock('../logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

const { execFile } = require('child_process');
const updateIcarus = require('../commands/update-icarus');

// ── Helpers ──

function mockInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        channel: { send: jest.fn().mockResolvedValue() },
    };
}

/**
 * Set up execFile to respond to SSH calls in sequence.
 * Each entry is { match, stdout, stderr, exitCode }.
 * `match` is a substring checked against the SSH command argument.
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

describe('update-icarus', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('formatElapsed', () => {
        test('formats seconds only', () => {
            const base = Date.now() - 45_000;
            expect(updateIcarus._formatElapsed(base)).toBe('45s');
        });

        test('formats minutes and seconds', () => {
            const base = Date.now() - 125_000;
            expect(updateIcarus._formatElapsed(base)).toBe('2m 5s');
        });
    });

    describe('command metadata', () => {
        test('exports valid slash command data', () => {
            expect(updateIcarus.data.name).toBe('update-icarus');
            expect(updateIcarus.data.description).toBeTruthy();
        });

        test('uses the correct app ID', () => {
            expect(updateIcarus.ICARUS_APP_ID).toBe('2089300');
        });
    });

    describe('execute — happy path', () => {
        test('full update cycle with build change', async () => {
            jest.useFakeTimers();
            const interaction = mockInteraction();

            stubSSH([
                // Stage 1: getBuildID — pre-update
                { match: 'app_status', stdout: 'BuildID 22000000\nsize on disk: 11GB' },
                // Stage 2: tasklist
                { match: 'tasklist', stdout: '"IcarusServer-Win64-Shipping.exe","1234"' },
                // Stage 2: taskkill
                { match: 'taskkill', stdout: 'SUCCESS' },
                // Stage 3: app_update
                { match: 'app_update', stdout: "Success! App '2089300' fully installed." },
                // Stage 4: wmic start
                { match: 'wmic', stdout: 'ReturnValue = 0' },
                // Stage 5: getBuildID — post-update
                { match: 'app_status', stdout: 'BuildID 22500000\nsize on disk: 11GB' },
            ]);

            const promise = updateIcarus.execute(interaction);
            // Fast-forward through the 5s delay after taskkill
            await jest.advanceTimersByTimeAsync(5000);
            await promise;

            // Should defer, then edit through all stages
            expect(interaction.deferReply).toHaveBeenCalledTimes(1);
            expect(interaction.editReply).toHaveBeenCalledTimes(7);

            // Final message should show build migration
            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            expect(finalMsg).toContain('22000000');
            expect(finalMsg).toContain('22500000');
            expect(finalMsg).toContain('✅');

            jest.useRealTimers();
        });

        test('reports no change when builds match', async () => {
            const interaction = mockInteraction();

            stubSSH([
                { match: 'app_status', stdout: 'BuildID 22500000' },
                { match: 'tasklist', stdout: 'no relevant process' },
                { match: 'app_update', stdout: "Success! App '2089300' fully installed." },
                { match: 'wmic', stdout: 'ReturnValue = 0' },
                { match: 'app_status', stdout: 'BuildID 22500000' },
            ]);

            await updateIcarus.execute(interaction);

            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            expect(finalMsg).toContain('⚠️');
            expect(finalMsg).toContain('no version change');
        });

        test('skips taskkill when server is not running', async () => {
            const interaction = mockInteraction();

            stubSSH([
                { match: 'app_status', stdout: 'BuildID 22000000' },
                { match: 'tasklist', stdout: '"System","4"' },
                // No taskkill call expected — goes straight to update
                { match: 'app_update', stdout: "Success! App '2089300' fully installed." },
                { match: 'wmic', stdout: 'ReturnValue = 0' },
                { match: 'app_status', stdout: 'BuildID 22500000' },
            ]);

            await updateIcarus.execute(interaction);

            // Verify taskkill was never called (only 5 SSH calls, not 6)
            expect(execFile).toHaveBeenCalledTimes(5);
        });
    });

    describe('execute — SteamCMD non-zero exit with success marker', () => {
        test('recovers when SteamCMD exits non-zero but output contains success', async () => {
            const interaction = mockInteraction();

            stubSSH([
                { match: 'app_status', stdout: 'BuildID 22000000' },
                { match: 'tasklist', stdout: '' },
                // SteamCMD exits with code 8 but stdout says success
                {
                    match: 'app_update',
                    stdout: "Update complete.\nSuccess! App '2089300' fully installed.",
                    exitCode: 8,
                },
                { match: 'wmic', stdout: 'ReturnValue = 0' },
                { match: 'app_status', stdout: 'BuildID 22500000' },
            ]);

            await updateIcarus.execute(interaction);

            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            expect(finalMsg).toContain('✅');
            expect(finalMsg).toContain('22500000');
        });
    });

    describe('execute — error handling', () => {
        test('surfaces "No subscription" with a clear message', async () => {
            const interaction = mockInteraction();

            stubSSH([
                { match: 'app_status', stdout: 'BuildID 22000000' },
                { match: 'tasklist', stdout: '' },
                {
                    match: 'app_update',
                    stdout: "ERROR! Failed to install app '2089300' (No subscription)",
                    exitCode: 8,
                },
            ]);

            await updateIcarus.execute(interaction);

            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            expect(finalMsg).toContain('❌');
            expect(finalMsg).toContain('No subscription');
        });

        test('surfaces "Missing configuration" with a clear message', async () => {
            const interaction = mockInteraction();

            stubSSH([
                { match: 'app_status', stdout: 'BuildID 22000000' },
                { match: 'tasklist', stdout: '' },
                {
                    match: 'app_update',
                    stdout: "ERROR! Failed to install app '2089300' (Missing configuration)",
                    exitCode: 8,
                },
            ]);

            await updateIcarus.execute(interaction);

            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            expect(finalMsg).toContain('❌');
            expect(finalMsg).toContain('config is stale');
        });

        test('reports failure when SteamCMD output lacks success marker', async () => {
            const interaction = mockInteraction();

            stubSSH([
                { match: 'app_status', stdout: 'BuildID 22000000' },
                { match: 'tasklist', stdout: '' },
                // Exits 0 but doesn't contain the success marker
                { match: 'app_update', stdout: 'Verifying install...\n0 bytes downloaded' },
            ]);

            await updateIcarus.execute(interaction);

            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            expect(finalMsg).toContain('❌');
            expect(finalMsg).toContain('did not report success');
        });

        test('falls back to channel.send if editReply throws', async () => {
            const interaction = mockInteraction();
            interaction.editReply
                .mockResolvedValueOnce() // defer stage
                .mockResolvedValueOnce() // stage 1
                .mockRejectedValue(new Error('Unknown interaction'));

            stubSSH([
                { match: 'app_status', exitCode: 1, stderr: 'Connection refused' },
            ]);

            await updateIcarus.execute(interaction);

            expect(interaction.channel.send).toHaveBeenCalledWith(
                expect.stringContaining('❌')
            );
        });

        test('handles getBuildID failure gracefully', async () => {
            const interaction = mockInteraction();

            stubSSH([
                // getBuildID fails
                { match: 'app_status', exitCode: 1, stderr: 'timeout' },
                // tasklist
                { match: 'tasklist', stdout: '' },
                // update succeeds
                { match: 'app_update', stdout: "Success! App '2089300' fully installed." },
                { match: 'wmic', stdout: 'ReturnValue = 0' },
                // post-update getBuildID also fails
                { match: 'app_status', exitCode: 1, stderr: 'timeout' },
            ]);

            await updateIcarus.execute(interaction);

            const finalMsg = interaction.editReply.mock.calls.at(-1)[0];
            // Should still succeed, just with unknown builds shown as '?'
            expect(finalMsg).toContain('✅');
            expect(finalMsg).toContain('?');
        });
    });
});
