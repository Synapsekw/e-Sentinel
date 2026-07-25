// Ported (Phase 1D / Task 5) from assets/js/ui/panels.js:1863-1936 (the
// topMenus registry: topMenuOpen/closeTopMenu/closeAllTopMenus/openTopMenu/
// registerTopMenu). Legacy built one persistent DOM node per menu at init
// time, appended it to document.body, and imperatively positioned/hid it;
// closeAllTopMenus (called from openTopMenu) was legacy's guarantee that
// only one menu could be open at once. The React port keeps every menu
// mounted and lets the single `openMenu` store field be that guarantee --
// only one TopMenuName can equal `openMenu` at a time, so opening one
// implicitly "closes" any other.
//
// The trigger buttons (#btn-docks/#btn-filter/#btn-layers) live in
// Topbar.tsx, a sibling component outside this task's scope, and only flip
// `openMenu` in the store. Position is therefore computed the same way
// legacy's openTopMenu did: `document.getElementById(buttonId)
// .getBoundingClientRect()`, read fresh every time the menu opens rather
// than cached, since this component has no other way to find its trigger.

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/shared/store'
import type { TopMenuName } from '@/shared/store'

export interface TopMenuProps {
  name: TopMenuName
  buttonId: string
  extraClass: string
  align: 'left' | 'right'
  children: ReactNode
}

export default function TopMenu({ name, buttonId, extraClass, align, children }: TopMenuProps) {
  const isOpen = useAppStore((s) => s.openMenu === name)
  const setOpenMenu = useAppStore((s) => s.setOpenMenu)
  const elRef = useRef<HTMLDivElement | null>(null)
  // panels.js:1890-1898 (openTopMenu's positioning). Empty until the first
  // open; irrelevant while hidden.
  const [style, setStyle] = useState<CSSProperties>({})

  useEffect(() => {
    if (!isOpen) return

    const btn = document.getElementById(buttonId)
    if (btn) {
      const r = btn.getBoundingClientRect()
      const next: CSSProperties = { top: r.bottom + 6 }
      if (align === 'left') {
        next.left = Math.max(8, r.left)
      } else {
        next.right = Math.max(8, window.innerWidth - r.right)
      }
      setStyle(next)
    }

    // panels.js:1922-1925: containment, not id equality, decides "was this
    // the trigger" (the button has child elements -- a caret, a label span).
    const onDocDown = (e: MouseEvent): void => {
      const target = e.target as Node
      const insideMenu = !!elRef.current && elRef.current.contains(target)
      const insideButton = !!btn && btn.contains(target)
      if (!insideMenu && !insideButton) setOpenMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenMenu(null)
    }

    // panels.js:1903: deferred so the same click that opened this menu
    // doesn't immediately close it via onDocDown.
    const deferId = setTimeout(() => document.addEventListener('mousedown', onDocDown), 0)
    document.addEventListener('keydown', onKey)

    return () => {
      clearTimeout(deferId)
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, buttonId, align, setOpenMenu])

  return createPortal(
    <div
      ref={elRef}
      id={name + '-menu'}
      className={'missions-menu top-menu' + (extraClass ? ' ' + extraClass : '')}
      role="menu"
      hidden={!isOpen}
      style={style}
    >
      {children}
    </div>,
    document.body,
  )
}
