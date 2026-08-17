-- The ₦6,500/year Canva row is labelled Private account but was incorrectly
-- stored as shared access, creating a duplicate Shared/Yearly option.
update public.tool_pricing
set access_type = 'private'
where id = 'a92a735d-687c-4dea-8bd7-1fa606188a37'
  and tool_slug = 'canva-pro'
  and label = 'Private account';
