// The menu wraps the tab bar ChatGPT-style: the whole app face is one
// rounded surface that slides right — swipe from the left edge, or tap
// your avatar in the header — revealing the panel mounted beneath it:
// account, library, and the product's public pages.

import { Slot } from 'expo-router';
import DrawerPanel from '../../components/DrawerPanel';
import SwipeMenuShell from '../../components/SwipeMenuShell';

export default function DrawerLayout() {
  return (
    <SwipeMenuShell menu={<DrawerPanel />}>
      <Slot />
    </SwipeMenuShell>
  );
}
