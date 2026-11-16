export const GRAMMARLY_PROVIDER_ACCOUNTS=["account_1","account_2"] as const;
export type GrammarlyProviderAccount=typeof GRAMMARLY_PROVIDER_ACCOUNTS[number];
export function isGrammarlyProviderAccount(value:unknown):value is GrammarlyProviderAccount{return value==="account_1"||value==="account_2";}
export function grammarlyAccountMatches(assigned:unknown,bound:unknown){return isGrammarlyProviderAccount(assigned)&&assigned===bound;}
