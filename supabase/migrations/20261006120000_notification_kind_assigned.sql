-- "You were assigned" notifications for tickets and planner tasks.
--
-- Kept in its own file: a new enum value cannot be *used* in the transaction
-- that adds it, and the migration-runner applies each file in one transaction.

alter type public.notification_kind add value if not exists 'assigned';
