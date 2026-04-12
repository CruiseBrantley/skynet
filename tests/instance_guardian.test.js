const InstanceGuardian = require('../util/InstanceGuardian');
const logger = require('../logger');
const os = require('os');

// Mock dependencies
jest.mock('../logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

jest.mock('os', () => ({
    hostname: jest.fn().mockReturnValue('test-host'),
}));

describe('InstanceGuardian', () => {
    let mockDb;
    let mockInstancesRef;
    let guardian;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockInstancesRef = {
            once: jest.fn(),
            set: jest.fn(),
            child: jest.fn().mockReturnThis(),
            remove: jest.fn(),
        };

        mockDb = {
            ref: jest.fn().mockReturnValue(mockInstancesRef),
        };

        guardian = new InstanceGuardian(mockDb);
    });

    test('should initialize and register heartbeat', async () => {
        mockInstancesRef.once.mockResolvedValue({ exists: () => false });
        mockInstancesRef.set.mockResolvedValue();

        await guardian.init();

        expect(mockDb.ref).toHaveBeenCalledWith('instances');
        expect(mockInstancesRef.child).toHaveBeenCalledWith(expect.stringContaining('test-host'));
        expect(mockInstancesRef.set).toHaveBeenCalledWith(expect.objectContaining({
            hostname: 'test-host',
            heartbeat: expect.any(Number),
        }));
    });

    test('should detect a conflict with a fresh instance', async () => {
        const now = Date.now();
        const mockData = {
            'other-host_123': {
                heartbeat: now - 30000, // 30 seconds ago (fresh)
                hostname: 'other-host',
            }
        };

        mockInstancesRef.once.mockResolvedValue({
            exists: () => true,
            val: () => mockData,
        });

        const isConflict = await guardian.checkConflict();

        expect(isConflict).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Conflict detected'));
    });

    test('should ignore a stale instance', async () => {
        const now = Date.now();
        const mockData = {
            'stale-host_123': {
                heartbeat: now - 600000, // 10 minutes ago (stale)
                hostname: 'stale-host',
            }
        };

        mockInstancesRef.once.mockResolvedValue({
            exists: () => true,
            val: () => mockData,
        });

        const isConflict = await guardian.checkConflict();

        expect(isConflict).toBe(false);
    });

    test('should cleanup on exit', async () => {
        // Mock process.exit to avoid killing the test runner
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        mockInstancesRef.remove.mockResolvedValue();

        await guardian.cleanup();

        expect(mockInstancesRef.remove).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);
        
        exitSpy.mockRestore();
    });
});
