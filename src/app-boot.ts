// Imported first by main.ts, so the app's network routing is in place before
// any other module can make a request.
import { installAppFetch } from './app-net'

installAppFetch()
