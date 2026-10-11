// The main screen, in the order docs/DESIGN.md lays out for portrait.

import { ControlsBar } from './ui/ControlsBar.js';
import { DriverStrip } from './ui/DriverStrip.js';
import { FlagBand } from './ui/FlagBand.js';
import { Header } from './ui/Header.js';
import { Overlay } from './ui/Overlay.js';
import { TimingTower } from './ui/TimingTower.js';
import { TrackArea } from './ui/TrackArea.js';

export function App(): React.JSX.Element {
  return (
    <>
      <FlagBand />
      <Header />
      <TrackArea />
      <DriverStrip />
      <TimingTower />
      <ControlsBar />
      <Overlay />
    </>
  );
}
