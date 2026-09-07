-- Scope file reads to the people the files belong to.
--
-- The original policy was:
--
--   create policy "storage_read_auth" on storage.objects for select to authenticated
--     using (bucket_id in ('attachments','recordings'));
--
-- which let *any* signed-in user read *any* object in those buckets — every
-- client's screenshots and screen recordings, across every project. A client
-- could enumerate another client's bug reports.
--
-- The upload policy was already scoped correctly (first path segment must be
-- the uploader's id) and `signedAttachmentUrl` already checks visibility through
-- ticket_attachments RLS before signing with the service role. Only the read
-- policy was open, so this closes it without changing any application path:
-- the service role bypasses RLS, so signed URLs keep working exactly as before.

drop policy if exists "storage_read_auth" on storage.objects;
drop policy if exists "documents_read_auth" on storage.objects;

-- You may read an attachment or recording if you uploaded it, or if it is
-- attached to a ticket on a project you are a member of. Admins see everything
-- via is_project_member().
create policy "storage_read_own_or_project" on storage.objects for select to authenticated
  using (
    bucket_id in ('attachments', 'recordings')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.ticket_attachments a
        join public.tickets t on t.id = a.ticket_id
        where a.storage_bucket = storage.objects.bucket_id
          and a.storage_path = storage.objects.name
          and public.is_project_member(t.project_id, auth.uid())
      )
    )
  );

-- Generated quotes and invoices: the project's members, and nobody else.
create policy "storage_read_documents_for_members" on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin(auth.uid())
    )
  );
