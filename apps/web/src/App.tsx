// The main screen, in the order docs/DESIGN.md lays out for portrait.

import { ControlsBar } from './ui/ControlsBar.js';
import { DriverStrip } from './ui/DriverStrip.js';
import { FlagBand } from './ui/FlagBand.js';
import { Header } from './ui/Header.js';
import { Finished } from './ui/Finished.js';
import { Overlay } from './ui/Overlay.js';
import { SessionPicker } from './ui/SessionPicker.js';
import { TelemetryPanel } from './ui/TelemetryPanel.js';
import { TimingTower } from './ui/TimingTower.js';
import { TrackArea } from './ui/TrackArea.js';
import { useStore } from './store/store.js';

export function App(): React.JSX.Element {
  // DriverDetail.dc.html: expanded, the panel takes the place of both the
  // strip and the tower, and the track gives up some height. The panel says
  // everything the strip does and more, so showing both would be saying the
  // speed twice.
  const expanded = useStore((s) => s.expanded && s.sel != null);
  // Finished.dc.html drops the track and the strip for the podium and the
  // classification. Only once the result is actually in: a chequered flag with
  // nothing to show would be a worse screen than the one it replaces.
  const finished = useStore((s) => s.timing?.flag === 'CHEQUERED' && s.result != null);

  if (finished) {
    return (
      <>
        <FlagBand />
        <Header />
        <Finished />
        <SessionPicker />
        <Overlay />
      </>
    );
  }

  return (
    <>
      <FlagBand />
      <Header />
      <TrackArea />
      {expanded ? (
        <TelemetryPanel />
      ) : (
        <>
          <DriverStrip />
          <TimingTower />
        </>
      )}
      <ControlsBar />
      <Overlay />
    </>
  );
}
