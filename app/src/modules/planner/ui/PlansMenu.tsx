// The PLANS dropdown: save, the list of saved plans, and the four
// import/export items. Presentational -- every action arrives through the
// `library` prop (ui/usePlanLibrary.ts), so this file owns only what the menu
// looks like and which row is currently confirming something.
//
// Confirmation is ALWAYS inline in the affected row, never window.confirm: a
// native modal blocks the event loop, and this app is driven live in front of
// an audience. A destructive click swaps the row's contents in place instead.
//
// Reuses the topbar's existing pl-dropdown / pl-menu / pl-menu-item pattern
// (the one DRAW and LAYERS already use); the list region additionally scrolls,
// exactly as the console's .docks-menu does for the same problem.
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PlanLibrary } from './usePlanLibrary'
import { plural } from './pluralize'

export interface PlansMenuProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
  library: PlanLibrary
  onImportPlanFile: (file: File) => void
  onExportPlan: () => void
}

type Confirm =
  { kind: 'overwrite' } | { kind: 'discard'; id: string } | { kind: 'delete'; id: string } | null

export default function PlansMenu({
  open,
  onToggle,
  onClose,
  library,
  onImportPlanFile,
  onExportPlan,
}: PlansMenuProps) {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const planInputRef = useRef<HTMLInputElement | null>(null)
  const libraryInputRef = useRef<HTMLInputElement | null>(null)

  // Reset whenever the menu closes, whichever way it closed. PlannerTopbar
  // owns "only one dropdown open at a time" and closes this one by flipping
  // `open` to false directly, without going through close() -- so without
  // this, a pending DELETE? banner or a half-typed rename is still there the
  // next time the menu opens.
  useEffect(() => {
    if (open) return
    setConfirm(null)
    setRenamingId(null)
  }, [open])

  function close() {
    setConfirm(null)
    setRenamingId(null)
    onClose()
  }

  function handleSaveClick() {
    // Only ask when there is genuinely something to overwrite.
    if (library.isSaved(library.currentPlanId)) setConfirm({ kind: 'overwrite' })
    else library.savePlan()
  }

  function handleRowClick(id: string) {
    if (library.dirty) setConfirm({ kind: 'discard', id })
    else {
      library.openPlan(id)
      close()
    }
  }

  function startRename(id: string, name: string) {
    setConfirm(null)
    setRenamingId(id)
    setDraftName(name)
  }

  function commitRename(id: string) {
    if (draftName.trim().length > 0) library.renamePlan(id, draftName)
    setRenamingId(null)
  }

  function handlePlanFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImportPlanFile(file)
    close()
  }

  function handleLibraryFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void library.importLibraryFile(file)
    close()
  }

  return (
    <>
      <button
        type="button"
        className="pl-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
      >
        PLANS ▾
      </button>
      {open ? (
        <div className="pl-menu pl-plans-menu" role="menu">
          {confirm?.kind === 'overwrite' ? (
            <div className="pl-confirm">
              <span className="lbl">OVERWRITE SAVED PLAN?</span>
              <button
                type="button"
                onClick={() => {
                  library.savePlan()
                  setConfirm(null)
                }}
              >
                OVERWRITE
              </button>
              <button type="button" onClick={() => setConfirm(null)}>
                CANCEL
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="pl-menu-item"
              disabled={!library.dirty}
              onClick={handleSaveClick}
            >
              {library.dirty ? 'SAVE PLAN' : 'SAVED'}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => {
              library.saveAsNew()
              setConfirm(null)
            }}
          >
            SAVE AS NEW
          </button>

          <div className="pl-menu-sep" />

          <div className="pl-menu-head lbl">
            {library.available
              ? `SAVED PLANS · ${library.entries.length}${
                  library.skipped > 0 ? ` · ${library.skipped} UNREADABLE` : ''
                }`
              : 'LIBRARY UNAVAILABLE'}
          </div>

          <div className="pl-menu-scroll">
            {library.entries.length === 0 && library.available ? (
              <span className="pl-empty lbl">NO SAVED PLANS</span>
            ) : null}
            {library.entries.map((entry) => {
              if (confirm?.kind === 'discard' && confirm.id === entry.id) {
                return (
                  <div className="pl-confirm" key={entry.id}>
                    <span className="lbl">UNSAVED CHANGES</span>
                    <button
                      type="button"
                      onClick={() => {
                        library.openPlan(entry.id)
                        close()
                      }}
                    >
                      DISCARD
                    </button>
                    <button type="button" onClick={() => setConfirm(null)}>
                      CANCEL
                    </button>
                  </div>
                )
              }
              if (confirm?.kind === 'delete' && confirm.id === entry.id) {
                return (
                  <div className="pl-confirm" key={entry.id}>
                    <span className="lbl">DELETE?</span>
                    <button
                      type="button"
                      onClick={() => {
                        library.deletePlan(entry.id)
                        setConfirm(null)
                      }}
                    >
                      YES
                    </button>
                    <button type="button" onClick={() => setConfirm(null)}>
                      CANCEL
                    </button>
                  </div>
                )
              }
              if (renamingId === entry.id) {
                return (
                  <div className="pl-plan-row" key={entry.id}>
                    <input
                      className="pl-input"
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(entry.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(entry.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  </div>
                )
              }
              return (
                <div className="pl-plan-row" key={entry.id}>
                  <button
                    type="button"
                    className="pl-plan-main"
                    onClick={() => handleRowClick(entry.id)}
                  >
                    <span className="pl-plan-name">{entry.name}</span>
                    <span className="pl-plan-meta">
                      {[
                        entry.customer.trim() || 'NO CUSTOMER',
                        plural(entry.aois.length, 'AOI'),
                        plural(entry.docks.length, 'DOCK'),
                      ].join(' · ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pl-icon-btn"
                    aria-label={`Rename ${entry.name}`}
                    onClick={() => startRename(entry.id, entry.name)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="pl-icon-btn"
                    aria-label={`Duplicate ${entry.name}`}
                    onClick={() => library.duplicatePlan(entry.id)}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="pl-icon-btn"
                    aria-label={`Delete ${entry.name}`}
                    onClick={() => setConfirm({ kind: 'delete', id: entry.id })}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>

          <div className="pl-menu-sep" />

          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => planInputRef.current?.click()}
          >
            IMPORT PLAN…
          </button>
          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => {
              onExportPlan()
              close()
            }}
          >
            EXPORT PLAN
          </button>
          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => libraryInputRef.current?.click()}
          >
            IMPORT LIBRARY…
          </button>
          <button
            type="button"
            role="menuitem"
            className="pl-menu-item"
            onClick={() => {
              library.exportLibraryFile()
              close()
            }}
          >
            EXPORT LIBRARY
          </button>

          <input
            ref={planInputRef}
            type="file"
            accept=".json"
            className="pl-hidden-input"
            onChange={handlePlanFile}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept=".json"
            className="pl-hidden-input"
            onChange={handleLibraryFile}
          />
        </div>
      ) : null}
    </>
  )
}
