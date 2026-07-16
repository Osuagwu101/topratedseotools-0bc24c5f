REVOKE ALL ON FUNCTION public.user_has_tool_access(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tool_access(UUID, TEXT) TO service_role;