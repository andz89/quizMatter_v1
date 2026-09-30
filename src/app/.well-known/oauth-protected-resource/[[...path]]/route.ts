/**
 * The OAuth "signpost" for the MCP server (/api/mcp): when Claude gets a 401 there, it reads this to learn where
 * to log in — Supabase's OAuth server. Served at /.well-known/oauth-protected-resource and, as some clients ask,
 * with the server's path after it (/.well-known/oauth-protected-resource/api/mcp). No login needed (see proxy.ts).
 */
export function GET(request: Request) {
  return Response.json({
    resource: `${new URL(request.url).origin}/api/mcp`,
    authorization_servers: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "QuizMatter",
  });
}
