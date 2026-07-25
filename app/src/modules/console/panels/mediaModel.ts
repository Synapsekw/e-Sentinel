// Ported (Phase 1E / Task 6) from assets/js/ui/panels.js:1006-1014
// (mediaPosterHTML) and :1016-1055 (renderMediaPanel's `typesPresent`
// dedup, panels.js:1023-1026). The JSX rendering itself (empty state,
// filter chips, .media-card grid) lives in MediaPanel.tsx; this module is
// the pure, store/DOM-free half so it can be unit-tested standalone.

import { VIDEO_MANIFEST } from '@/modules/console/domain'
import type { Mission, MissionType } from '@/modules/console/domain'

// panels.js:1010-1014. Legacy served a bare `videos/<file>` relative path
// with a `#t=0.8` fragment (a scrub-to-frame hint so the muted,
// preload="metadata" <video> paints a non-black poster frame without
// fetching the whole clip); this app is served under a base path, so the
// URL is prefixed with `import.meta.env.BASE_URL`, matching
// debriefModel.ts's debriefVideoSources. Returns null when the manifest has
// no clip for the type (legacy emitted no <video> element at all in that
// case) — MediaPanel.tsx renders a CSS-only fallback tile for that case,
// and also whenever the returned src 404s (see that file's header comment:
// only videos/security-01..08.mp4 exist on disk, so every other mission
// type's "poster" 404s and must fail gracefully rather than showing a
// broken-video icon).
export function mediaPosterSrc(type: MissionType): string | null {
  const variants = VIDEO_MANIFEST[type] || []
  if (!variants.length) return null
  return `${import.meta.env.BASE_URL}videos/${variants[0]}#t=0.8`
}

// panels.js:1023-1026: the ALL chip plus one chip per mission type actually
// present in this session's missions, in first-seen order (not
// MISSIONS_CONFIG's declaration order, and never duplicated).
export function mediaFilterTypes(sessionMissions: readonly Mission[]): MissionType[] {
  const typesPresent: MissionType[] = []
  for (const m of sessionMissions) {
    if (typesPresent.indexOf(m.type) === -1) typesPresent.push(m.type)
  }
  return typesPresent
}
