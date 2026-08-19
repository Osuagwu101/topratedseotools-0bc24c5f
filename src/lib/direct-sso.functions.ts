import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const startSneakWriteDirectSso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tool_slug: z.literal("sneakwrite") }).parse(input))
  .handler(async ({ context }) => {
    const { createSneakWriteDirectSsoForUser } = await import("@/lib/direct-sso.server");
    return createSneakWriteDirectSsoForUser(context.userId);
  });
