// The main screen, in the order docs/DESIGN.md lays out for portrait.
//
// One tree rather than a return per state, deliberately: the track is a WebGL
// context with a scene in it, and swapping between separate trees unmounts
// and rebuilds it. Opening a session — loading, then running — is the common
// path, and it should not throw the circuit away halfway through.

import { ControlsBar } from './ui/ControlsBar.js';
import { DriverStrip } from './ui/DriverStrip.js';
import { FlagBand } from './ui/FlagBand.js';
import { Header } from './ui/Header.js';
import { Finished } from './ui/Finished.js';
import { Overlay } from './ui/Overlay.js';
import { Glance } from './ui/Glance.js';
import { Loading } from './ui/Loading.js';
import { Locked } from './ui/Locked.js';
import { Reconnecting } from './ui/Reconnecting.js';
import { Settings } from './ui/Settings.js';
import { WakeLock } from './ui/WakeLock.js';
import { SyncSheet } from './ui/SyncSheet.js';
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
  const locked = useStore((s) => s.mode === 'locked');
  // Nothing has arrived yet: no outline and no cars. Once either lands the
  // ordinary screen has something to show, so the staged list gets out of the
  // way rather than waiting for everything.
  const loading = useStore(
    (s) => (s.circuit?.points.length ?? 0) === 0 && (s.tick?.cars.length ?? 0) === 0,
  );

  // Glance replaces everything but the band while it is on, and that includes
  // letting the scene go. It draws its own flat map, so holding a WebGL
  // context open behind it would burn battery on a phone propped up for an
  // hour to show nothing. Rotation never crosses this branch, so the camera
  // and the cars still survive what the milestone asks about.
  const glance = useStore((s) => s.glance);

  const showTrack = !locked && !finished && !glance;

  return (
    <>
      <FlagBand />
      <Header />
      {showTrack && <Reconnecting />}
      {showTrack && <TrackArea />}

      {glance ? (
        <Glance />
      ) : locked ? (
        <Locked />
      ) : finished ? (
        <Finished />
      ) : loading ? (
        <Loading />
      ) : (
        <>
          {expanded ? (
            <TelemetryPanel />
          ) : (
            <>
              <DriverStrip />
              <TimingTower />
            </>
          )}
          <ControlsBar />
        </>
      )}

      <SyncSheet />
      <Settings />
      {/* Its "loading car positions" is about the track, which this screen drops. */}
      {!finished && <Overlay />}
      <WakeLock />
    </>
  );
}
