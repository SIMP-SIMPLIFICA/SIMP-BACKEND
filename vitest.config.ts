import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.{test,spec}.ts'],
        // Os testes de integração têm configuração própria (vitest.config.e2e.ts)
        // porque exigem Postgres no ar. Sem esta exclusão, `npm test` tentaria
        // rodá-los e falharia em qualquer máquina sem banco.
        exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.e2e.spec.ts'],
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
            // Thresholds zerados até a cobertura ser expandida — subir gradualmente
            thresholds: {
                lines: 0,
                functions: 0,
                branches: 0,
                statements: 0,
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