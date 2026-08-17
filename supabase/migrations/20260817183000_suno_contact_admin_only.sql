-- Suno is not directly purchasable until Admin explicitly replaces this policy.
-- Keep the existing Contact Admin row and disable the direct monthly price.
update public.tool_pricing
set enabled = false
where id = '866fb216-26a0-4e5b-9eea-0881662e67ba'
  and tool_slug = 'suno';
