import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.{test,spec}.ts'],
        // forks: processo isolado por suite → evita estado compartilhado de DB
        pool: 'forks',
        isolate: true,
        // Timeout generoso para testes de integração com DB
        testTimeout: 30_000,
        hookTimeout: 30_000,
        teardownTimeout: 30_000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'node_modules/**',
                'dist/**',
                'coverage/**',
                '**/*.d.ts',
                '**/*.test.ts',
                '**/*.spec.ts',
                'src/test/**',
                'src/types/**',
                'scripts/**',
                'prisma/**',
                'src/index.ts',
            ],
            // Thresholds progressivos — começamos em 60/70 e subimos conforme cobertura cresce
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 60,
                statements: 70,
            },
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
    esbuild: {
        target: 'node22',
    },
})