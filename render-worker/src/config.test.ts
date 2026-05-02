import { describe, it, expect, vi, afterEach } from 'vitest';

describe('config', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('parses valid config with defaults', async () => {
        vi.stubEnv('RENDER_SECRET', 'test-secret-123');
        // PORT not set — should use default 8080
        delete process.env.PORT;

        const { config } = await import('./config');
        expect(config.RENDER_SECRET).toBe('test-secret-123');
        expect(config.PORT).toBe(8080);
    });

    it('parses PORT from env', async () => {
        vi.stubEnv('RENDER_SECRET', 'secret');
        vi.stubEnv('PORT', '3000');

        const { config } = await import('./config');
        expect(config.PORT).toBe(3000);
    });

    it('exits on missing RENDER_SECRET', async () => {
        delete process.env.RENDER_SECRET;
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit called');
        });

        await expect(import('./config')).rejects.toThrow('process.exit called');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
