import { useCallback } from 'react';
import type { Runtime } from '../runtime.ts';
import { store, useUi } from '../store.ts';
import { DevPanel } from './DevPanel.tsx';
import { Calibrate } from './screens/Calibrate.tsx';
import { Customize } from './screens/Customize.tsx';
import { Hud } from './screens/Hud.tsx';
import { Menu, Setup } from './screens/Menu.tsx';
import { Paused, Results, ServerBanner, Toast } from './screens/Overlays.tsx';
import { Pairing, Title } from './screens/Pairing.tsx';
import { PracticeHud } from './screens/Practice.tsx';
import { Tutorial } from './screens/Tutorial.tsx';

export function App({ rt }: { rt: Runtime }) {
  const { screen, devOpen, mode } = useUi();
  const leaveTitle = useCallback(() => {
    if (store.get().screen === 'title') rt.go(store.get().phone.phone === 'calibrated' ? 'menu' : 'pairing');
  }, [rt]);
  return (
    <>
      {(screen === 'playing' || screen === 'paused') && (mode === 'practice' ? <PracticeHud rt={rt} /> : <Hud />)}
      {screen === 'tutorial' && <Tutorial rt={rt} />}
      {screen === 'title' && <Title onDone={leaveTitle} />}
      {screen === 'pairing' && <Pairing rt={rt} />}
      {screen === 'calibrate' && <Calibrate rt={rt} />}
      {screen === 'menu' && <Menu rt={rt} />}
      {screen === 'setup' && <Setup rt={rt} />}
      {screen === 'customize' && <Customize rt={rt} />}
      {screen === 'paused' && <Paused rt={rt} />}
      {screen === 'matchOver' && <Results rt={rt} />}
      <ServerBanner rt={rt} />
      <Toast />
      {devOpen && <DevPanel rt={rt} />}
    </>
  );
}
