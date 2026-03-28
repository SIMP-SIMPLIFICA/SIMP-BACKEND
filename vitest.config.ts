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
            // Thresholds realistas para o estágio atual do projeto (~5% linha, 35% funções)
            // Subir gradualmente conforme novos testes são adicionados
            thresholds: {
                lines: 4,
                functions: 30,
                branches: 50,
                statements: 4,
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