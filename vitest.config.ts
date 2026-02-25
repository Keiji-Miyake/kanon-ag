import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // ESM モジュールをそのまま扱うための設定
        globals: true,
        environment: 'node',
        // TypeScript のエイリアス解決 (NodeNext の .js 拡張子)
        include: ['tests/**/*.test.ts'],
        // カバレッジの設定
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/cli/**', 'src/extension/**'],
        },
    },
    resolve: {
        // .js 拡張子を .ts にリダイレクト (ESM + TypeScript の相互運用)
        extensions: ['.ts', '.js'],
    },
});
