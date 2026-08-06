import { createApiClient } from './core/api-client';
import { ORIGIN } from './origin';

// The shared core client, aimed at the deployed origin. Native fetches ride
// the system cookie jar — the same one the WebViews use — so a sign-in
// anywhere in the app signs in everything.
export const api = createApiClient({ origin: ORIGIN });
