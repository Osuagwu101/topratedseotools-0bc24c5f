import {useEffect,useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {adminGetClaudeControls,adminUpdateClaudeControls} from "@/lib/claude-controls.functions";
export function ClaudeControlsCard({userId}:{userId:string}){
 const qc=useQueryClient(),key=["admin-claude-controls",userId];
 const {data,error,isLoading}=useQuery({queryKey:key,queryFn:()=>adminGetClaudeControls({data:{userId}})});
 const [limit,setLimit]=useState("25");
 useEffect(()=>{if(data)setLimit(String(data.limit));},[data,userId]);
 const value=Number(limit),valid=limit.trim()!==""&&Number.isInteger(value)&&value>=0&&value<=10000;
 const save=useMutation({mutationFn:()=>adminUpdateClaudeControls({data:{userId,daily_message_limit:value}}),
 onSuccess:()=>{toast.success("Claude daily limit saved");qc.invalidateQueries({queryKey:key});},
 onError:(e:Error)=>toast.error(e.message)});
 return <div className="mt-6 rounded-2xl border bg-card p-4">
  <h2 className="text-sm font-semibold">Claude message limit</h2>
  <p className="mt-1 text-xs text-muted-foreground">Default: 25 messages per writer each day. Resets at midnight Nigeria time. Changes apply immediately; 0 blocks new messages.</p>
  {isLoading?<p className="mt-3 text-sm">Loading Claude controls???</p>:error?<p role="alert" className="mt-3 text-sm text-destructive">{(error as Error).message}</p>:<>
   <p className="mt-3 text-sm">Today: {data?.used??0} used ?? {data?.remaining??0} remaining</p>
   <div className="mt-3 max-w-xs"><Label htmlFor="claude-message-limit">Daily messages</Label>
    <Input id="claude-message-limit" type="number" min={0} max={10000} step={1} value={limit} onChange={e=>setLimit(e.target.value)}/>
   </div>
   <Button className="mt-3" size="sm" disabled={!valid||save.isPending} onClick={()=>save.mutate()}>{save.isPending?"Saving???":"Save Claude limit"}</Button>
  </>}
 </div>;
}
