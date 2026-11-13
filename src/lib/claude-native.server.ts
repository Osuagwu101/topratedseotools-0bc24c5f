/* Retired extension experiment. Claude uses the dedicated server proxy. */
const message = "The Claude extension pilot has ended. Launch Claude through TopRated.";
export async function issueClaudeNativeAdminHandoff(_userId: string): Promise<{ticket:string;expires_at:string}> {
  throw new Error(message);
}
export async function issueClaudeNativeWriterHandoff(_userId: string): Promise<{ticket:string;expires_at:string}> {
  throw new Error(message);
}
export async function handleClaudeNativeRedeem(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({ok:false,error:message}), {
    status:410,
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
  });
}
