// Who is signed in, app-wide — plus the unseen-notifications count that
// badges the bell. Refreshed whenever the session epoch bumps (sign-in or
// sign-out anywhere in the app).

import { createContext } from 'react';

export type Me = {
  id?: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string | null;
  role?: string;
} | null;

export const AccountContext = createContext<{
  me: Me;
  unseen: number;
  clearUnseen: () => void;
}>({ me: null, unseen: 0, clearUnseen: () => {} });
