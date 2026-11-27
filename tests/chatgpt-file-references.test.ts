import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { attachmentFileIds, createdUploadFileId } from "../src/lib/chatgpt-file-reference-model";
import { attachmentRefs } from "../src/lib/chatgpt-attachment-model";

const own = "file_00000000_owned";
const other = "file-other_writer";
for (const id of [undefined, null, "", randomUUID(), "ui-attachment-key"]) {
  const a = { id, file_id: own, name: "document.pdf" };
  assert.deepEqual(attachmentFileIds(a), [own]);
  assert.equal(createdUploadFileId(a), own);
  const messageId=randomUUID();
  const snapshot:any={id:randomUUID(),current_node:messageId,mapping:{[messageId]:{
    id:messageId,parent:null,children:[],message:{id:messageId,author:{role:"user"},
      content:{content_type:"text",parts:["Read this"]},metadata:{attachments:[a]}},
  }}};
  const [ref]=attachmentRefs(snapshot);
  assert.equal(ref.kind,"file");
  assert.equal(ref.fileId,own,"Backup and message authorization must use the same provider ID");
}
assert.deepEqual(attachmentFileIds({id:own}),[own]);
assert.deepEqual(attachmentFileIds({file_id:own}),[own]);
assert.deepEqual(attachmentFileIds({id:own,file_id:own}),[own]);
assert.deepEqual(attachmentFileIds({id:other,file_id:own}),[own,other],"Every valid reference must pass ownership");
assert.equal(createdUploadFileId({id:other,file_id:own}),undefined,"Ambiguous upload responses cannot claim ownership");
for(const a of [null,[],{}, {id:randomUUID()}, {id:"https://example.com/file_fake"}, {file_id:"file_bad/path"}]) {
  assert.deepEqual(attachmentFileIds(a),[]);
  assert.equal(createdUploadFileId(a),undefined);
}
console.log("ChatGPT provider file references: canonical fields, client IDs, ambiguity and invalid IDs passed");
