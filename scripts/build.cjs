// Only browser assets are published. Secrets, scripts, tests and source ZIPs stay out.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'public');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const name of ['app.js','index.html','styles.css','data-admin.js','data-admin.css','secure-auth.js','secure-auth.css','firebase-messaging-sw.js','manifest.json','apple-touch-icon.png','app-icons','avatars','icons','images','login','notification-icons']){
 const src=path.join(root,name);if(fs.existsSync(src))fs.cpSync(src,path.join(out,name),{recursive:true});
}
