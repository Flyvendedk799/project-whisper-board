/**
 * The only place in the client that talks to the database.
 *
 * Routes and components import query options from here; ESLint stops them
 * calling `supabase.from()` themselves. That is what makes the query-key
 * factory, the pagination rules and the "never drop an error" rule hold
 * everywhere rather than wherever someone remembered.
 */
export { qk } from "./keys";
export * from "./types";
export * from "./enums";
export * from "./filters";
export * from "./ticket-origin";
export * from "./tickets";
export * from "./projects";
export * from "./billing";
export * from "./meetings";
export * from "./notifications";
export * from "./time";
export * from "./views";
export * from "./planner";
