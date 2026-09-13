import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({
				out: 'build'
			})
		})
	],
	server: {
		allowedHosts: true
	},
	build: {
		// SMUI の生成 CSS に不正な変数名 (空白入り ident) が含まれており、
		// lightningcss の minify が厳格に失敗するため esbuild を使う。
		// 根本原因は @smui 側の CSS 生成バグ (別途対応)。
		cssMinify: 'esbuild'
	},
	environments: {
		ssr: {
			build: {
				cssMinify: 'esbuild'
			}
		},
		client: {
			build: {
				cssMinify: 'esbuild'
			}
		}
	}
});
