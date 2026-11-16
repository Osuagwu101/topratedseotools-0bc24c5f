export const CLAUDE_PROVIDER_ACCOUNTS = ["account_1", "account_2"] as const;
export type ClaudeProviderAccountKey = typeof CLAUDE_PROVIDER_ACCOUNTS[number];
export function isClaudeProviderAccount(value: unknown): value is ClaudeProviderAccountKey {
 return value === "account_1" || value === "account_2";
}
export function claudeSessionMatchesAccount(assigned: unknown, session: unknown) {
 return isClaudeProviderAccount(assigned) && assigned === session;
}
