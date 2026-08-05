// The web app's API surface: the shared core client, constructed for the
// same-origin case (relative paths, cookie session).
import { apiError, createApiClient } from './api-client.js';

export { apiError };
export const api = createApiClient();
