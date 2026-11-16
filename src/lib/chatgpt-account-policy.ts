export const CHATGPT_PROVIDER_ACCOUNTS=["account_1","account_2"] as const;
export type ChatGptProviderAccount=typeof CHATGPT_PROVIDER_ACCOUNTS[number];
export function isChatGptProviderAccount(value:unknown):value is ChatGptProviderAccount{return value==="account_1"||value==="account_2";}
export function chatGptAccountMatches(assigned:unknown,bound:unknown){return isChatGptProviderAccount(assigned)&&assigned===bound;}
