/**
 * The providers that can only run on the server.
 *
 * `providers/index.ts` is imported by browser components (the error boundary and
 * the root route pull `captureError` out of it), so everything re-exported there
 * has to survive the client bundle. Email does not: the SMTP transport imports
 * `node:tls`, and a bundler asked to put that in a browser build can only fail.
 *
 * Splitting the barrel is what keeps that honest. Server functions import from
 * here; components import from `index.ts`; nothing has to remember which is
 * which, because the wrong choice fails at build time rather than at runtime.
 */

export { getEmailProvider, resetEmailProvider } from "./email";
