import { lazy, Suspense } from 'react'
import BubbleLayout from './components/BubbleLayout'
import Hud from './components/Hud'
import SetupPanel from './components/SetupPanel'
import TitleScreen from './components/TitleScreen'
import { useSim } from './ui/store'

// The 3D scene is by far the biggest part of the download, so it arrives after the interface.
const Scene = lazy(() => import('./components/Scene'))

export default function App() {
  const screen = useSim((s) => s.screen)
  return (
    <>
      <Suspense fallback={<p className="loading">Waking the fruit…</p>}>
        <Scene />
      </Suspense>
      <BubbleLayout />
      {screen === 'title' ? <TitleScreen /> : screen === 'setup' ? <SetupPanel /> : <Hud />}
    </>
  )
}
