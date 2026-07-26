import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { MODULES, type ModuleCard } from './modules'
import DroneField from './DroneField'
import './Landing.css'

function Card({ mod }: { mod: ModuleCard }) {
  const inner = (
    <>
      <div className="m-head">
        <span className="m-num">{mod.num}</span>
        <span className={`m-status ${mod.status}`}>
          <span className="dot" />
          {mod.statusLabel}
        </span>
      </div>
      <h2>{mod.title}</h2>
      <p className="m-blurb">{mod.blurb}</p>
      {/* The card's affordance row. Enabled cards say what clicking does and
          carry an arrow that shifts on hover; planned ones state their status
          instead, so "not built yet" is communicated by wording rather than by
          dimming the card until its text fails contrast. */}
      <div className="m-go">
        <span>{mod.enabled ? 'Open module' : 'Not yet deployed'}</span>
        {mod.enabled ? (
          <span className="arw" aria-hidden="true">
            &rarr;
          </span>
        ) : null}
      </div>
    </>
  )
  if (!mod.enabled) {
    return (
      <div className="mcard" data-enabled="false" aria-disabled="true">
        {inner}
      </div>
    )
  }
  return (
    <Link className="mcard" data-enabled="true" to={`/${mod.slug}`}>
      {inner}
    </Link>
  )
}

export default function Landing() {
  // DroneField measures both of these every resize: the content block is what
  // the field dims behind for legibility, the module grid is where the fleet
  // ignites before spreading outward.
  const contentRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLElement>(null)

  return (
    <main className="landing">
      <DroneField contentRef={contentRef} gridRef={gridRef} />
      <div className="landing-inner" ref={contentRef}>
        <header className="landing-brand">
          <h1>SENTINEL</h1>
          <div className="landing-mark">e-Sentinel C2</div>
          <div className="landing-sub">Physical Intelligence · Unified Drone Operations</div>
        </header>
        <nav className="modules" aria-label="Modules" ref={gridRef}>
          {MODULES.map((mod) => (
            <Card key={mod.slug} mod={mod} />
          ))}
        </nav>
        <footer className="landing-foot">
          © 2026 e& · Simulated environment · All operational data synthetic
        </footer>
      </div>
    </main>
  )
}
