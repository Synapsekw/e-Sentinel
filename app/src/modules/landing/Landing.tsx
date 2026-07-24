import { Link } from 'react-router-dom'
import { MODULES, type ModuleCard } from './modules'
import './Landing.css'

function Card({ mod }: { mod: ModuleCard }) {
  const inner = (
    <>
      <div className="m-head">
        <span className="m-num lbl">{mod.num}</span>
        <span className={`m-status ${mod.status}`}>
          <span className="dot" />
          {mod.statusLabel}
        </span>
      </div>
      <h2>{mod.title}</h2>
      <p className="lbl">{mod.blurb}</p>
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
  return (
    <main className="landing">
      <div className="landing-brand">
        <h1>SENTINEL</h1>
        <div className="lbl landing-sub">PHYSICAL INTELLIGENCE · UNIFIED DRONE OPERATIONS</div>
      </div>
      <nav className="modules" aria-label="Modules">
        {MODULES.map((mod) => (
          <Card key={mod.slug} mod={mod} />
        ))}
      </nav>
      <footer className="lbl landing-foot">
        © 2026 e& · SIMULATED ENVIRONMENT · ALL OPERATIONAL DATA SYNTHETIC
      </footer>
    </main>
  )
}
