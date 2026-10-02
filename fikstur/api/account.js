'use strict';
const {services}=require('../server/firebase.cjs');
const {identify,execute}=require('../server/service.cjs');
const {Fault}=require('../server/policy.cjs');
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try {
    if(req.method!=='POST') throw new Fault(405,'Yalnızca POST destekleniyor.');
    const origins=String(process.env.APP_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);
    if(!origins.length || !origins.includes(req.headers.origin)) throw new Fault(403,'İstek kaynağı izinli değil.');
    if(!String(req.headers['content-type']||'').startsWith('application/json')) throw new Fault(415,'JSON gerekli.');
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!body || JSON.stringify(body).length>30000) throw new Fault(400,'Geçersiz istek.');
    const bearer=/^Bearer (\S+)$/.exec(req.headers.authorization||'');
    if(!bearer) throw new Fault(401,'Giriş gerekli.');
    const service=services(),actor=await identify(service.auth,service.db,bearer[1]);
    // Private server-owned counter limits all API calls per account.
    const minute=Math.floor(Date.now()/60000);
    const limit=await service.db.ref(`serverPrivate/rate/${actor.uid}`).transaction(old=>{
      const count=old?.minute===minute?Number(old.count||0):0;
      if(count>=90) return;
      return {minute,count:count+1};
    });
    if(!limit.committed) throw new Fault(429,'Çok fazla işlem. Bir dakika sonra tekrar deneyin.');
    const result=await execute(service,actor,body.action,body.payload||{});
    res.status(200).json(result);
  }catch(error){
    const status=error instanceof Fault?error.status:500;
    // Never log request bodies, passwords, tokens or service credentials.
    if(status===500) console.error('Account API failed:',error.code||error.name||'Error');
    res.status(status).json({success:false,...(error.publicCode?{code:error.publicCode}:{}),message:status===500?'Sunucu işlemi tamamlanamadı. Yapılandırmayı kontrol edin.':error.message});
  }
};
