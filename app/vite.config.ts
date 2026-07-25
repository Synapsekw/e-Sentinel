/// <reference types="vitest/config" />
import { createReadStream, statSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import type { Connect, Plugin, ViteDevServer, PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'

// The mission debrief / FPV downlink clips live at the REPO root (`videos/`),
// outside `app/`, because the legacy vanilla site serves them from there and
// the Pages workflow publishes that directory alongside the app. They are
// ~240MB of mp4, so they are deliberately NOT copied into `app/public/`
// (which Vite would then duplicate into every `dist/`). Instead both the dev
// and preview servers mount the real directory at `/videos`, matching the
// production URL that `${import.meta.env.BASE_URL}videos/<file>` resolves to.
const VIDEOS_DIR = fileURLToPath(new URL('../videos', import.meta.url))

function serveRepoVideos(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? ''
    const match = /^(?:\/e-Sentinel)?\/videos\/([\w.-]+)$/.exec(url.split('?')[0])
    if (!match) return next()
    const file = `${VIDEOS_DIR}/${match[1]}`
    let size: number
    try {
      size = statSync(file).size
    } catch {
      return next()
    }
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Accept-Ranges', 'bytes')

    // Honour Range so the <video> element streams instead of pulling the
    // whole ~30MB clip up front (and so seeking works at all).
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size || end < start) {
        res.statusCode = 416
        res.setHeader('Content-Range', `bytes */${size}`)
        res.end()
        return
      }
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', String(end - start + 1))
      createReadStream(file, { start, end }).pipe(res)
      return
    }

    res.setHeader('Content-Length', String(size))
    createReadStream(file).pipe(res)
  }
  return {
    name: 'serve-repo-videos',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(middleware)
    },
  }
}

// GitHub Pages serves the project under /e-Sentinel/; local dev serves at /.
// React Router reads import.meta.env.BASE_URL so its basename stays in sync.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/e-Sentinel/' : '/',
  plugins: [react(), serveRepoVideos()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}))
