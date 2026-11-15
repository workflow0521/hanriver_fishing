import {publicHydrology} from '../src/hrfco-public.mjs';

await Promise.all(['ttukseom','yanghwa','mangwon','banpo'].map(async zone=>{
 const began=Date.now();
 try{
  const data=await publicHydrology('water',zone,6);
  console.log(JSON.stringify({zone,status:'ok',samples:data.rows.length,last:data.rows.at(-1).time,ms:Date.now()-began}));
 }catch(error){
  console.log(JSON.stringify({zone,status:error.cause?.code||error.name,ms:Date.now()-began}));
  process.exitCode=1;
 }
}));
