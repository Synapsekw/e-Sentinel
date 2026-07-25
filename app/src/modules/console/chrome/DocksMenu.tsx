// Ported (Phase 1D / Task 5) from assets/js/ui/panels.js:1938-1948
// (wireDocksMenu). Legacy built this menu's static shell
// (`<div class="mm-head lbl">Dock network</div><div id="docklist"></div>`)
// once at init and repainted #docklist on every open via
// EC2.ui.renderDockList(); the React port just always renders <DockList/>
// inside, and DockList.tsx's own effects handle the "only poll while open"
// behavior that repaint used to gate on topMenuOpen('docks').

import TopMenu from './TopMenu'
import DockList from './DockList'

export default function DocksMenu() {
  return (
    <TopMenu name="docks" buttonId="btn-docks" extraClass="docks-menu" align="left">
      <div className="mm-head lbl">Dock network</div>
      <DockList />
    </TopMenu>
  )
}
