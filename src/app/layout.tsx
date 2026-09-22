import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "WoodTek ERP | Furniture Service Center Manufacturing Platform",
  description: "Advanced order tracking, shop floor machine scheduling, real-time workflow operation routing, and touchscreen operator controls for furniture service centers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Inline (survives chunk-404 deploys): surfaces JS errors as a red
            banner so a broken page tells you why instead of freezing silently. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `(function(){
  function show(msg){
    try{
      if(document.getElementById("woodtek-err-banner"))return;
      var d=document.createElement("div");
      d.id="woodtek-err-banner";
      d.style.cssText="position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:560px;background:#450a0a;color:#fecaca;border:1px solid #f43f5e;border-radius:12px;padding:10px 14px;font:12px/1.5 monospace;white-space:pre-wrap;box-shadow:0 8px 24px rgba(0,0,0,.5)";
      d.textContent="WoodTek JS error: "+msg;
      var x=document.createElement("button");
      x.type="button";x.textContent="\\u2715";
      x.style.cssText="margin-left:10px;background:none;border:0;color:#fecaca;cursor:pointer;font-size:14px";
      x.onclick=function(){d.remove();};
      d.appendChild(x);
      document.body.appendChild(d);
      console.error("WoodTek JS error:",msg);
    }catch(e){}
  }
  window.addEventListener("error",function(e){
    var t=e.target;
    if(!t||(t===window)||t.nodeType===1&&(t.tagName==="SCRIPT"||t.tagName==="LINK")){
      show((e.message||"Script failed to load")+ (t&&t.tagName==="SCRIPT"?(" ["+(e.filename||"")+" :"+(e.lineno||"?")+"]"):"")+(e.message?"":" ["+(e.filename||"")+" :"+(e.lineno||"?")+"]"));
    }
  });
  window.addEventListener("unhandledrejection",function(e){
    show("Promise: "+(e.reason&&(e.reason.message||String(e.reason)))||"unknown");
  });
})();`,
          }}
        />
      </head>
      <body className="bg-slate-950 text-slate-100 antialiased overflow-hidden selection:bg-amber-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
