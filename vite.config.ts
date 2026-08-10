import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 部署在 /<repo>/ 子路径下，通过环境变量注入。
// 本地开发和自定义域名时保持 '/'。
const base = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
  server: {
    port: 5180,
    // 本地开发时代理国内政务信源，绕开浏览器 CORS 限制
    proxy: {
      '/proxy/std': {
        target: 'https://std.samr.gov.cn',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/proxy\/std/, ''),
      },
      '/proxy/openstd': {
        target: 'https://openstd.samr.gov.cn',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/proxy\/openstd/, ''),
      },
    },
  },
})
