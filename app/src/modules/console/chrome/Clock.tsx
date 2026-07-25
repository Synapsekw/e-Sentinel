// Ported from assets/js/ui/panels.js:2560-2566 (wireClock). Legacy painted
// `#clock`'s innerHTML with nowClockStr() + ' <span>GST</span>' immediately,
// then repainted on a 1000ms setInterval for the lifetime of the page; here
// the interval is scoped to the component's effect and cleared on unmount.

import { useEffect, useState } from 'react'
import { nowClockStr } from './format'

export default function Clock() {
  const [time, setTime] = useState(nowClockStr)

  useEffect(() => {
    const id = setInterval(() => setTime(nowClockStr()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div id="clock">
      {time} <span>GST</span>
    </div>
  )
}
