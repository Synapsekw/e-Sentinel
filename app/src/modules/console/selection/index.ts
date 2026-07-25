// Public barrel for the selection state machine (Phase 1D / Task 3). Later
// tasks (5, 6, 7, 8) should import from '@/modules/console/selection'
// rather than reaching into individual files under this directory.

export {
  selectEntity,
  clearSelection,
  openMediaLibrary,
  openDebrief,
  selectedDockId,
  inCaptureMode,
  registerCaptureExits,
} from './selectEntity'
export { useMapSelection } from './useMapSelection'
export { useFollowDriver } from './useFollowDriver'
export { useMapTrackInteractions, focusTrack } from './useMapTrackInteractions'
