import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import { discoverExtensionPaths, extensionWrapper, isSelfHostedBuild, readExtensionSource } from './build-config.ts'

const selfHosted = isSelfHostedBuild()
const extensionPaths = selfHosted ? discoverExtensionPaths() : []

export default defineConfig({
  define: {
    __BOARD_SELF_HOSTED__: JSON.stringify(selfHosted),
    __BOARD_EXTENSION_PATHS__: JSON.stringify(extensionPaths),
  },
  plugins: [{
    name: 'package-allowed-self-host-extensions',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url || '/', 'http://localhost').pathname
        if (!path.startsWith('/extensions/')) { next(); return }
        if (!selfHosted || !extensionPaths.includes(path)) { response.statusCode = 404; response.end(); return }
        const source = readExtensionSource(path)
        if (source === null) { response.statusCode = 404; response.end(); return }
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.setHeader('X-Frame-Options', 'SAMEORIGIN')
        response.end(extensionWrapper(source))
      })
    },
    closeBundle() {
      copyFileSync(resolve('LICENSE'), resolve('dist/LICENSE'))
      copyFileSync(resolve('TRADEMARKS.md'), resolve('dist/TRADEMARKS.md'))
      const outputRoot = resolve('dist/extensions')
      rmSync(outputRoot, { recursive: true, force: true })
      if (!selfHosted) return
      for (const path of extensionPaths) {
        const source = readExtensionSource(path)
        if (source === null) continue
        const destination = resolve('dist', path.slice(1))
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, extensionWrapper(source))
      }
    },
  }],
})
