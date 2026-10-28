import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PhraslyCustomerControlsCard} from './PhraslyCustomerControlsCard';
export function mountPhraslyCustomerControls(element:HTMLElement,userId:string){
 const client=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:0}}}),root=createRoot(element);
 root.render(<QueryClientProvider client={client}><PhraslyCustomerControlsCard userId={userId}/></QueryClientProvider>);
 return ()=>{root.unmount();client.clear();};
}
