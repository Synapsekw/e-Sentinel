import { Link, useLocation } from 'react-router-dom'

export default function ModulePlaceholder() {
  const { pathname } = useLocation()
  const name = pathname.replace('/', '').toUpperCase() || 'MODULE'
  return (
    <main
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 24, letterSpacing: '0.2em', color: '#fff' }}>{name}</h1>
      <div className="lbl">MODULE PORT IN PROGRESS</div>
      <Link className="lbl" to="/" style={{ color: 'var(--txt)' }}>
        ← BACK TO MODULES
      </Link>
    </main>
  )
}
